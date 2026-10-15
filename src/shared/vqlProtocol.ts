import { VaultApiError } from '../core/rest/errors';
import type {
	QueryDescribe,
	QueryResult,
	VaultFieldMeta,
	VaultObjectMetadataSummary,
	VaultObjectSummary,
	VaultPicklistValue,
	VaultRelationshipMeta,
} from '../core/rest/types';
import type { SavedQuery } from '../core/vql/savedQueries';

export type { SavedQuery };

/**
 * Typed message protocol for the VQL Editor webview ↔ extension host bus. Kept vscode-free and
 * DOM-free so it can be imported by both the host (esbuild node bundle) and the webview (esbuild
 * browser bundle). Query requests are correlated to responses by `requestId`.
 */

export type ConnectionSnapshotStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** What the webview needs to render its header + gate the Run button. Pushed by the host. */
export interface ConnectionSnapshot {
	status: ConnectionSnapshotStatus;
	/** Target Vault DNS + label, present once connected. */
	vaultDns?: string;
	label?: string;
	isProduction: boolean;
}

/** Vault error normalized to a stable shape. */
export interface NormalizedError {
	type: string;
	message: string;
	response?: Record<string, unknown>;
}

/** Pagination metadata from a query's first page, used to calculate export scope. */
export interface PaginationMeta {
	/** Total row count across all pages. */
	total: number;
	/** Rows per page (consistent across all pages). */
	pagesize: number;
}

/** Outcome of a CSV export: a saved path, or `undefined` savedPath when the user cancelled the dialog. */
export interface ExportResult {
	savedPath?: string;
	rowCount?: number;
	error?: NormalizedError;
}

export interface VqlEditorState {
	vql: string;
	result?: QueryResult;
	elapsedMs?: number;
	lastRunVql?: string;
	/**
	 * The last run's target object, from that run's `queryDescribe.object.name` — captured once at run
	 * time because paginated responses don't carry `queryDescribe`, so it survives paging through the
	 * same result set.
	 */
	lastRunTarget?: string;
	/**
	 * That run's full `queryDescribe`, captured the same way and for the same reason as `lastRunTarget`
	 * (paginated responses omit it) — the grid reuses it to derive columns (including subquery field
	 * lists) on every page, since a query's columns can't legitimately change page-to-page.
	 */
	lastRunDescribe?: QueryDescribe;
	/**
	 * The last run's pagination metadata from the first page's responseDetails. Captured for CSV export
	 * confirmation so the modal can show accurate counts and API call estimates even when the user has
	 * paged forward.
	 */
	lastRunPagination?: PaginationMeta;
	error?: NormalizedError;
	viewMode: 'grid' | 'json';
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHostMessage =
	| { type: 'ready' }
	| { type: 'runQuery'; requestId: string; vql: string }
	| { type: 'queryByPage'; requestId: string; pageUrl: string }
	| { type: 'exportCsv'; requestId: string; vql: string; pagination: PaginationMeta }
	| { type: 'clearHistory' }
	| { type: 'saveQuery'; vql: string }
	| { type: 'deleteSavedQuery'; name: string }
	| { type: 'queryTargetsRequest'; requestId: string }
	| { type: 'queryConfigurableObjectsRequest'; requestId: string }
	| { type: 'queryFieldsRequest'; requestId: string; target: string }
	| { type: 'queryRelationshipsRequest'; requestId: string; target: string }
	| { type: 'queryPicklistFieldsRequest'; requestId: string; target: string }
	| { type: 'queryPicklistValuesRequest'; requestId: string; picklist: string }
	| { type: 'clipboardReadRequest'; requestId: string }
	| { type: 'updateState'; state: VqlEditorState };

/** Messages sent from the extension host to the webview. */
export type HostToWebviewMessage =
	| { type: 'connectionState'; state: ConnectionSnapshot }
	| { type: 'queryResponse'; requestId: string; result: QueryResult }
	| { type: 'queryError'; requestId: string; error: NormalizedError }
	| ({ type: 'exportResult'; requestId: string } & ExportResult)
	| { type: 'history'; entries: string[] }
	| { type: 'savedQueries'; entries: SavedQuery[] }
	| { type: 'queryTargetsResponse'; requestId: string; targets: VaultObjectSummary[] }
	| {
			type: 'queryConfigurableObjectsResponse';
			requestId: string;
			objects: VaultObjectMetadataSummary[];
	  }
	| { type: 'queryFieldsResponse'; requestId: string; target: string; fields: VaultFieldMeta[] }
	| {
			type: 'queryRelationshipsResponse';
			requestId: string;
			target: string;
			relationships: VaultRelationshipMeta[];
	  }
	| {
			type: 'queryPicklistFieldsResponse';
			requestId: string;
			target: string;
			/** `field name → picklist name` for the target; a field's presence marks it a picklist. */
			picklistFields: Record<string, string>;
	  }
	| {
			type: 'queryPicklistValuesResponse';
			requestId: string;
			picklist: string;
			values: VaultPicklistValue[];
	  }
	| { type: 'clipboardReadResponse'; requestId: string; text: string }
	| { type: 'restoreState'; state?: VqlEditorState };

/**
 * Shape an unknown thrown value into the stable `{type, message, response}` NormalizedError
 * contract. Shared by the host (which throws `VaultApiError`, or a plain `Error`) and the 
 * webview (which mostly receives an already-`NormalizedError`-shaped plain object over 
 * `postMessage` — `VaultApiError` never survives that trip as a class instance — but may also
 *  catch a plain `Error` from local code, e.g. the VQL formatter).
 */
export function normalizeError(e: unknown): NormalizedError {
	if (e instanceof VaultApiError) {
		// VaultApiError.message is prefixed with the type (for logs/tests); callers show type
		// separately, so strip the prefix here to avoid "FAILURE: FAILURE: …" in the banner.
		const prefix = `${e.type}: `;
		const message = e.message.startsWith(prefix) ? e.message.slice(prefix.length) : e.message;
		return { type: e.type, message, response: e.response };
	}
	if (e instanceof Error) {
		return { type: e.name, message: e.message };
	}
	if (typeof e === 'object' && e !== null && 'message' in e) {
		const shaped = e as { type?: unknown; message?: unknown; response?: unknown };
		return {
			type: typeof shaped.type === 'string' ? shaped.type : 'ERROR',
			message: typeof shaped.message === 'string' ? shaped.message : String(e),
			response:
				typeof shaped.response === 'object' && shaped.response !== null
					? (shaped.response as Record<string, unknown>)
					: undefined,
		};
	}
	return { type: 'ERROR', message: String(e) };
}
