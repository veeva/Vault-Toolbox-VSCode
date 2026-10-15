import type {
	QueryResult,
	VaultFieldMeta,
	VaultObjectMetadataSummary,
	VaultObjectSummary,
	VaultPicklistValue,
	VaultRelationshipMeta,
} from '../core/rest/types';
import type {
	ConnectionSnapshot,
	ExportResult,
	NormalizedError,
	PaginationMeta,
	SavedQuery,
} from '../shared/vqlProtocol';
import { onHostMessage, postToHost } from './vscodeApi';

/**
 * Webview half of the query bus (see `VqlBus` in the extension host for what "bus" means here):
 * request/response correlation over `postMessage`, VS Code's message channel between this webview's
 * embedded page and the extension host. Each request gets a `requestId`; a single message listener
 * fans host responses back to the matching pending promise. Correlation is generic over the payload
 * type so queries, pagination, and CSV export share it.
 */

interface Pending {
	resolve(value: unknown): void;
	reject(error: NormalizedError): void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Backstop for a host reply that never arrives (host crash / dropped message). Not a query SLA —
 * it is generous so it never aborts a legitimately slow query or paginated CSV export; it exists
 * only so the pending promise and its Map entry can't leak and hang the UI forever.
 */
const REQUEST_TIMEOUT_MS = 5 * 60_000;

const pending = new Map<string, Pending>();
let requestSequence = 0;

onHostMessage((message) => {
	if (message.type === 'queryResponse') {
		settle(message.requestId, (pendingRequest) => pendingRequest.resolve(message.result));
	} else if (message.type === 'queryError') {
		settle(message.requestId, (pendingRequest) => pendingRequest.reject(message.error));
	} else if (message.type === 'exportResult') {
		const { type: _type, requestId, ...result } = message;
		settle(requestId, (pendingRequest) => pendingRequest.resolve(result));
	} else if (message.type === 'queryTargetsResponse') {
		settle(message.requestId, (pendingRequest) => pendingRequest.resolve(message.targets));
	} else if (message.type === 'queryConfigurableObjectsResponse') {
		settle(message.requestId, (pendingRequest) => pendingRequest.resolve(message.objects));
	} else if (message.type === 'queryFieldsResponse') {
		settle(message.requestId, (pendingRequest) => pendingRequest.resolve(message.fields));
	} else if (message.type === 'queryRelationshipsResponse') {
		settle(message.requestId, (pendingRequest) => pendingRequest.resolve(message.relationships));
	} else if (message.type === 'queryPicklistFieldsResponse') {
		settle(message.requestId, (pendingRequest) => pendingRequest.resolve(message.picklistFields));
	} else if (message.type === 'queryPicklistValuesResponse') {
		settle(message.requestId, (pendingRequest) => pendingRequest.resolve(message.values));
	} else if (message.type === 'clipboardReadResponse') {
		settle(message.requestId, (pendingRequest) => pendingRequest.resolve(message.text));
	}
});

function settle(requestId: string, apply: (pendingRequest: Pending) => void): void {
	const pendingRequest = pending.get(requestId);
	if (pendingRequest) {
		clearTimeout(pendingRequest.timer);
		apply(pendingRequest);
		pending.delete(requestId);
	}
}

function request<T>(send: (requestId: string) => void): Promise<T> {
	const requestId = `q${requestSequence++}`;
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(requestId);
			reject({ type: 'TIMEOUT', message: 'The extension host did not respond.' });
		}, REQUEST_TIMEOUT_MS);
		pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
		send(requestId);
	});
}

export function runQuery(vql: string): Promise<QueryResult> {
	return request((requestId) => postToHost({ type: 'runQuery', requestId, vql }));
}

export function queryByPage(pageUrl: string): Promise<QueryResult> {
	return request((requestId) => postToHost({ type: 'queryByPage', requestId, pageUrl }));
}

/** Ask the host to export the given query's full result set to a CSV file (host shows a save dialog). */
export function exportCsv(vql: string, pagination: PaginationMeta): Promise<ExportResult> {
	return request((requestId) => postToHost({ type: 'exportCsv', requestId, vql, pagination }));
}

/** Fetch the Vault query-target list for completion (host caches; safe to call per completion). */
export function requestQueryTargets(): Promise<VaultObjectSummary[]> {
	return request((requestId) => postToHost({ type: 'queryTargetsRequest', requestId }));
}

/** Fetch the configurable-object list (`GET /metadata/vobjects`); host caches per vault. Backs the VQL
 *  Builder's object-vs-dynamic relationship split (membership = "is this a real object"). */
export function requestConfigurableObjects(): Promise<VaultObjectMetadataSummary[]> {
	return request((requestId) => postToHost({ type: 'queryConfigurableObjectsRequest', requestId }));
}

/** Fetch a target's fields for completion (host caches per target). */
export function requestQueryFields(target: string): Promise<VaultFieldMeta[]> {
	return request((requestId) => postToHost({ type: 'queryFieldsRequest', requestId, target }));
}

/** Fetch a target's relationships for the Query Builder (host caches per target). */
export function requestQueryRelationships(target: string): Promise<VaultRelationshipMeta[]> {
	return request((requestId) =>
		postToHost({ type: 'queryRelationshipsRequest', requestId, target }),
	);
}

/** Fetch a target's `field → picklistName` map for the WHERE builder (host caches the vault-wide
 *  index; a field's presence marks it a picklist). */
export function requestPicklistFields(target: string): Promise<Record<string, string>> {
	return request((requestId) => postToHost({ type: 'queryPicklistFieldsRequest', requestId, target }));
}

/** Fetch one picklist's values (name + label) for the WHERE builder (host caches per picklist name). */
export function requestPicklistValues(picklist: string): Promise<VaultPicklistValue[]> {
	return request((requestId) =>
		postToHost({ type: 'queryPicklistValuesRequest', requestId, picklist }),
	);
}

/**
 * Read the OS clipboard via the extension host (`vscode.env.clipboard.readText()`). Monaco doesn't
 * bind a paste keybinding inside a webview (see `MonacoEditor`), so this is how Ctrl/Cmd+V is served.
 */
export function requestClipboardText(): Promise<string> {
	return request((requestId) => postToHost({ type: 'clipboardReadRequest', requestId }));
}

/** Subscribe to host-pushed connection snapshots. Returns an unsubscribe. */
export function onConnectionState(handler: (state: ConnectionSnapshot) => void): () => void {
	return onHostMessage((message) => {
		if (message.type === 'connectionState') {
			handler(message.state);
		}
	});
}

/** Subscribe to host-pushed query-history updates (newest first). Returns an unsubscribe. */
export function onHistory(handler: (entries: string[]) => void): () => void {
	return onHostMessage((message) => {
		if (message.type === 'history') {
			handler(message.entries);
		}
	});
}

/** Ask the host to clear the persisted query history. */
export function clearHistory(): void {
	postToHost({ type: 'clearHistory' });
}

/** Subscribe to host-pushed saved-query updates (newest first). Returns an unsubscribe. */
export function onSavedQueries(handler: (entries: SavedQuery[]) => void): () => void {
	return onHostMessage((message) => {
		if (message.type === 'savedQueries') {
			handler(message.entries);
		}
	});
}

/** Ask the host to save the given query (the host prompts for a name, then pushes the updated list). */
export function saveQuery(vql: string): void {
	postToHost({ type: 'saveQuery', vql });
}

/** Ask the host to delete a saved query by name (host pushes the updated list). */
export function deleteSavedQuery(name: string): void {
	postToHost({ type: 'deleteSavedQuery', name });
}

/** Ask the host to push the current connection state (called once on mount). */
export function announceReady(): void {
	postToHost({ type: 'ready' });
}
