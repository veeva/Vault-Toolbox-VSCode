import { isProductionVault } from '../../core/production';
import type { QueryResult, QueryRow, ToolboxFeatureArea } from '../../core/rest/types';
import type { VaultClient } from '../../core/rest/vaultClient';
import { deriveGridColumns, isSubqueryValue, toCsv } from '../../core/vql/resultGrid';
import type { SavedQuery } from '../../core/vql/savedQueries';
import type { RunnableConnection } from '../connection/types';
import type { VqlStateStore } from './vqlWebviewHost';
import {
	normalizeError,
	type ConnectionSnapshot,
	type HostToWebviewMessage,
	type WebviewToHostMessage,
} from '../../shared/vqlProtocol';
import { handleMetadataRequest, type MetadataPort } from './vqlMetadataHandler';

/** Every Vault API call the VQL Editor tab makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-vql-editor';

/** Threshold for triggering the large export confirmation modal. */
const LARGE_EXPORT_THRESHOLD = 10000;

/**
 * Summary of a completed CSV export, handed to the {@link VqlBusDeps.exportSink} so the host can
 * confirm it to the user. `rowCount` is the number of top-level records exported.
 */
export interface ExportMeta {
	rowCount: number;
}

/** Persisted query history; `QueryHistoryStore` satisfies it. */
export interface QueryHistoryPort {
	list(): string[];
	add(vql: string): Promise<string[]>;
	clear(): Promise<void>;
}

/** Persisted named queries; `SavedQueryStore` satisfies it. */
export interface SavedQueryPort {
	list(): SavedQuery[];
	add(name: string, vql: string): Promise<SavedQuery[]>;
	remove(name: string): Promise<SavedQuery[]>;
}

export interface VqlBusDeps {
	connection: RunnableConnection;
	post(message: HostToWebviewMessage): void;
	/**
	 * Persist CSV text to a file chosen by the user; resolves to the saved path, or `undefined` when
	 * the user cancels. `meta` lets the host surface a confirmation. Provided by the vscode host
	 * (`VqlEditorPanel`); absent in unit tests.   */
	exportSink?(csv: string, suggestedName: string, meta: ExportMeta): Promise<string | undefined>;
	/**
	 * Confirm a large export (≥10k rows) with the user before proceeding. Shows a modal with the
	 * row count and API call count. Resolves to `true` if the user confirms, `false` if cancelled.
	 * Provided by the vscode host; absent in unit tests (which bypass the check).
	 */
	confirmLargeExport?(total: number, apiCalls: number): Promise<boolean>;
	/** Query history persistence; when absent, history is simply not tracked. */
	history?: QueryHistoryPort;
	/** Metadata source for completion; when absent, completion gets empty suggestions. */
	metadata?: MetadataPort;
	/** Saved-query persistence; when absent, saving is disabled. */
	savedQueries?: SavedQueryPort;
	/** State store for VQL Editor state synchronization across views. */
	stateStore?: VqlStateStore;
	/**
	 * Prompt the user for a name to save the current query under (a vscode InputBox). Resolves to the
	 * trimmed name, or `undefined` when cancelled/blank. Absent in unit tests / when saving is off.
	 */
	promptSaveName?(): Promise<string | undefined>;
	/**
	 * Read the OS clipboard text (the vscode host's `vscode.env.clipboard.readText`). Monaco doesn't
	 * bind Ctrl/Cmd+V inside a webview — the DOM clipboard API is unreliable there — so the editor asks
	 * the host to read the OS clipboard instead. Absent in unit tests; when absent, reads resolve empty.
	 */
	clipboard?(): Promise<string>;
}

/**
 * Routes webview messages onto the connected Vault. "Bus" here just means: one object that receives
 * every message the webview sends over VS Code's `postMessage` channel
 * (https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing) and
 * dispatches each to its handler below, posting the result/error back the same way. Queries run
 * through `connection.run()` so a stale session recovers transparently (silent Basic re-auth /
 * prompt) before the response is posted back. Vscode-free so the routing + error normalization are
 * unit-testable with a fake connection + post.
 */
export class VqlBus {
	constructor(private readonly deps: VqlBusDeps) {}

	async handle(message: unknown): Promise<void> {
		if (!isValidMessage(message)) {
			// Drop malformed/untrusted input: the compile-time union is not enforced at runtime, and a
			// buggy or compromised webview must not flow junk (e.g. a non-string vql) into the client.
			return;
		}
		try {
			await this.dispatch(message);
		} catch {
			// Best-effort persistence (history / saved-query writes) must not become an unhandled
			// rejection — callers invoke handle() as `void`. Query and export errors are already posted
			// back to the webview inside execute()/exportCsv().
		}
	}

	private async dispatch(message: WebviewToHostMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
				this.pushConnectionState();
				this.pushHistory();
				this.pushSavedQueries();
				this.pushRestoreState();
				return;
			case 'updateState':
				this.deps.stateStore?.set(message.state);
				return;
			case 'runQuery': {
				const ok = await this.execute(message.requestId, (client) =>
					client.vql.query(message.vql, REFERENCE_ID),
				);
				if (ok && this.deps.history) {
					this.deps.post({ type: 'history', entries: await this.deps.history.add(message.vql) });
				}
				return;
			}
			case 'queryByPage':
				await this.execute(message.requestId, (client) =>
					client.vql.queryByPage(message.pageUrl, REFERENCE_ID),
				);
				return;
			case 'exportCsv': {
				// Check if this is a large export that needs confirmation
				if (message.pagination.total >= LARGE_EXPORT_THRESHOLD && this.deps.confirmLargeExport) {
					const apiCalls = Math.ceil(message.pagination.total / message.pagination.pagesize);
					const confirmed = await this.deps.confirmLargeExport(message.pagination.total, apiCalls);
					if (!confirmed) {
						// User cancelled - post empty result so the webview's promise resolves and resets state
						this.deps.post({ type: 'exportResult', requestId: message.requestId });
						return;
					}
				}
				await this.exportCsv(message.requestId, message.vql);
				return;
			}
			case 'clearHistory':
				await this.deps.history?.clear();
				this.pushHistory();
				return;
			case 'saveQuery': {
				if (this.deps.savedQueries && this.deps.promptSaveName) {
					const name = await this.deps.promptSaveName();
					if (name) {
						await this.deps.savedQueries.add(name, message.vql);
						this.pushSavedQueries();
					}
				}
				return;
			}
			case 'deleteSavedQuery':
				if (this.deps.savedQueries) {
					await this.deps.savedQueries.remove(message.name);
					this.pushSavedQueries();
				}
				return;
			case 'queryTargetsRequest':
			case 'queryConfigurableObjectsRequest':
			case 'queryFieldsRequest':
			case 'queryRelationshipsRequest':
			case 'queryPicklistFieldsRequest':
			case 'queryPicklistValuesRequest':
				this.deps.post(await handleMetadataRequest(message, this.deps.metadata));
				return;
			case 'clipboardReadRequest': {
				const text = (await this.deps.clipboard?.()) ?? '';
				this.deps.post({ type: 'clipboardReadResponse', requestId: message.requestId, text });
				return;
			}
			default:
				assertNever(message);
		}
	}

	/** Push the persisted query history to the webview, if history is tracked. */
	private pushHistory(): void {
		if (this.deps.history) {
			this.deps.post({ type: 'history', entries: this.deps.history.list() });
		}
	}

	/** Push the persisted saved queries to the webview, if saving is enabled. */
	private pushSavedQueries(): void {
		if (this.deps.savedQueries) {
			this.deps.post({ type: 'savedQueries', entries: this.deps.savedQueries.list() });
		}
	}

	/** Push the synchronized VQL Editor state to the webview if present. */
	private pushRestoreState(): void {
		const state = this.deps.stateStore?.get();
		this.deps.post({ type: 'restoreState', state });
	}

	/**
	 * Re-run the query from page 1 and follow `next_page` until exhausted, then hand the
	 * serialized CSV to the host's `exportSink` (a save dialog). Each page is its own `connection.run`
	 * so a mid-export stale session recovers per page. Includes
	 * subquery-pagination expansion (`resolveSubqueryPages`/`toCsv`) so every subquery record is
	 * exported, not just the grid's first page.
	 */
	private async exportCsv(requestId: string, vql: string): Promise<void> {
		if (!this.deps.exportSink) {
			this.deps.post({
				type: 'exportResult',
				requestId,
				error: { type: 'ERROR', message: 'CSV export is unavailable.' },
			});
			return;
		}
		try {
			const rows: QueryRow[] = [];
			let result = await this.deps.connection.run((client) => client.vql.query(vql, REFERENCE_ID));
			const describe = result.queryDescribe;
			for (;;) {
				rows.push(...result.data);
				const next = result.responseDetails.nextPage;
				if (!next) {
					break;
				}
				result = await this.deps.connection.run((client) =>
					client.vql.queryByPage(next, REFERENCE_ID),
				);
			}
			const columns = deriveGridColumns(rows, describe);
			const resolvedRows: QueryRow[] = [];
			for (const row of rows) {
				resolvedRows.push(await this.resolveSubqueryPages(row));
			}
			// The query's target object, straight from Vault's own describe response — never re-derived
			// by parsing `vql` (see getQueryTargetFromQueryString's doc comment on why not).
			const target = describe?.object?.name;
			const suggestedName = target ? `query_results (${target}).csv` : 'query_results.csv';
			const savedPath = await this.deps.exportSink(toCsv(columns, resolvedRows), suggestedName, {
				rowCount: rows.length,
			});
			this.deps.post({
				type: 'exportResult',
				requestId,
				savedPath,
				rowCount: rows.length,
			});
		} catch (error) {
			this.deps.post({ type: 'exportResult', requestId, error: normalizeError(error) });
		}
	}

	/**
	 * Follow each of a row's subquery `next_page` chains to completion — a separate pagination per
	 * subquery field — so CSV export contains every subquery record, not just the grid's first page.
	 * A no-op (returns `row` as-is) when it has no subqueries.
	 */
	private async resolveSubqueryPages(row: QueryRow): Promise<QueryRow> {
		let resolved: QueryRow | undefined;
		for (const [key, value] of Object.entries(row)) {
			if (!isSubqueryValue(value)) {
				continue;
			}
			const data = Array.isArray(value.data) ? [...value.data] : [];
			let next = value.responseDetails?.next_page;
			while (next) {
				const page = await this.deps.connection.run((client) =>
					client.vql.queryByPage(next as string, REFERENCE_ID),
				);
				data.push(...page.data);
				next = page.responseDetails.nextPage;
			}
			(resolved ??= { ...row })[key] = { ...value, data };
		}
		return resolved ?? row;
	}

	/** Push the current connection snapshot to the webview (call on connection-state changes too). */
	pushConnectionState(): void {
		this.deps.post({ type: 'connectionState', state: this.snapshot() });
	}

	/** Run a query through `connection.run` and post the result/error. Returns true on success. */
	private async execute(
		requestId: string,
		fn: (client: VaultClient) => Promise<QueryResult>,
	): Promise<boolean> {
		try {
			const result = await this.deps.connection.run(fn);
			this.deps.post({ type: 'queryResponse', requestId, result });
			return true;
		} catch (error) {
			this.deps.post({ type: 'queryError', requestId, error: normalizeError(error) });
			return false;
		}
	}

	private snapshot(): ConnectionSnapshot {
		const state = this.deps.connection.getState();
		const info = state.info;
		const isProduction =
			state.status === 'connected' &&
			!!info &&
			isProductionVault(info.domain?.domainType, info.environment.vaultDNS);
		return {
			status: state.status,
			vaultDns: info?.environment.vaultDNS,
			label: info?.environment.label,
			isProduction,
		};
	}
}

/** Compile-time guarantee that the message switch is exhaustive; a no-op at runtime. */
function assertNever(_message: never): void {
	// unreachable: every WebviewToHostMessage variant is handled above.
}

/**
 * Validate an untrusted webview message at runtime: it must be an object with a known `type` and
 * the string fields that variant requires. Anything else is dropped by {@link VqlBus.handle}.
 */
function isValidMessage(message: unknown): message is WebviewToHostMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}
	const fields = message as Record<string, unknown>;
	const isString = (value: unknown): value is string => typeof value === 'string';
	const isNumber = (value: unknown): value is number => typeof value === 'number';
	const isPaginationMeta = (value: unknown): boolean =>
		typeof value === 'object' &&
		value !== null &&
		isNumber((value as Record<string, unknown>).total) &&
		isNumber((value as Record<string, unknown>).pagesize);
	switch (fields.type) {
		case 'ready':
		case 'clearHistory':
			return true;
		case 'runQuery':
			return isString(fields.requestId) && isString(fields.vql);
		case 'exportCsv':
			return isString(fields.requestId) && isString(fields.vql) && isPaginationMeta(fields.pagination);
		case 'queryByPage':
			return isString(fields.requestId) && isString(fields.pageUrl);
		case 'saveQuery':
			return isString(fields.vql);
		case 'deleteSavedQuery':
			return isString(fields.name);
		case 'queryTargetsRequest':
		case 'queryConfigurableObjectsRequest':
		case 'clipboardReadRequest':
			return isString(fields.requestId);
		case 'queryFieldsRequest':
		case 'queryRelationshipsRequest':
		case 'queryPicklistFieldsRequest':
			return isString(fields.requestId) && isString(fields.target);
		case 'queryPicklistValuesRequest':
			return isString(fields.requestId) && isString(fields.picklist);
		case 'updateState':
			return typeof fields.state === 'object' && fields.state !== null;
		default:
			return false;
	}
}

