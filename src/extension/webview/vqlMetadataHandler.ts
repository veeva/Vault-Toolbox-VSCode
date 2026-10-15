import type {
	VaultFieldMeta,
	VaultObjectMetadataSummary,
	VaultObjectSummary,
	VaultPicklistValue,
	VaultRelationshipMeta,
} from '../../core/rest/types';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../shared/vqlProtocol';

/** Metadata source for VQL completion; `MetadataService` satisfies it. */
export interface MetadataPort {
	getTargets(): Promise<VaultObjectSummary[]>;
	getConfigurableObjects(): Promise<VaultObjectMetadataSummary[]>;
	getFields(target: string): Promise<VaultFieldMeta[]>;
	getRelationships(target: string): Promise<VaultRelationshipMeta[]>;
	getPicklistFields(target: string): Promise<Record<string, string>>;
	getPicklistValues(picklist: string): Promise<VaultPicklistValue[]>;
}

/** The six webview → host metadata request message variants. */
export type MetadataRequest = Extract<
	WebviewToHostMessage,
	| { type: 'queryTargetsRequest' }
	| { type: 'queryConfigurableObjectsRequest' }
	| { type: 'queryFieldsRequest' }
	| { type: 'queryRelationshipsRequest' }
	| { type: 'queryPicklistFieldsRequest' }
	| { type: 'queryPicklistValuesRequest' }
>;

/** The six host → webview metadata response message variants. */
export type MetadataResponse = Extract<
	HostToWebviewMessage,
	| { type: 'queryTargetsResponse' }
	| { type: 'queryConfigurableObjectsResponse' }
	| { type: 'queryFieldsResponse' }
	| { type: 'queryRelationshipsResponse' }
	| { type: 'queryPicklistFieldsResponse' }
	| { type: 'queryPicklistValuesResponse' }
>;

/**
 * Dispatch one metadata request to the appropriate `MetadataPort` method and return the typed
 * response. All six fetch-and-respond paths run through this one function, sharing the safe
 * fallback wrapper: a failed fetch degrades to an empty result rather than surfacing an error to
 * the webview (completion never shows errors). When `metadata` is absent, every response is empty.
 */
export async function handleMetadataRequest(
	request: MetadataRequest,
	metadata: MetadataPort | undefined,
): Promise<MetadataResponse> {
	switch (request.type) {
		case 'queryTargetsRequest':
			return {
				type: 'queryTargetsResponse',
				requestId: request.requestId,
				targets: await safe(() => metadata?.getTargets() ?? [], []),
			};
		case 'queryConfigurableObjectsRequest':
			return {
				type: 'queryConfigurableObjectsResponse',
				requestId: request.requestId,
				objects: await safe(() => metadata?.getConfigurableObjects() ?? [], []),
			};
		case 'queryFieldsRequest':
			return {
				type: 'queryFieldsResponse',
				requestId: request.requestId,
				target: request.target,
				fields: await safe(() => metadata?.getFields(request.target) ?? [], []),
			};
		case 'queryRelationshipsRequest':
			return {
				type: 'queryRelationshipsResponse',
				requestId: request.requestId,
				target: request.target,
				relationships: await safe(() => metadata?.getRelationships(request.target) ?? [], []),
			};
		case 'queryPicklistFieldsRequest':
			return {
				type: 'queryPicklistFieldsResponse',
				requestId: request.requestId,
				target: request.target,
				picklistFields: await safe(() => metadata?.getPicklistFields(request.target) ?? {}, {}),
			};
		case 'queryPicklistValuesRequest':
			return {
				type: 'queryPicklistValuesResponse',
				requestId: request.requestId,
				picklist: request.picklist,
				values: await safe(() => metadata?.getPicklistValues(request.picklist) ?? [], []),
			};
	}
}

/** Run a metadata fetch, degrading to `fallback` on any error — completion never surfaces errors. */
async function safe<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
	try {
		return await fn();
	} catch {
		return fallback;
	}
}
