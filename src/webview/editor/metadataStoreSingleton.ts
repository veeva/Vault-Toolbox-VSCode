import {
	onConnectionState,
	requestConfigurableObjects,
	requestPicklistFields,
	requestPicklistValues,
	requestQueryFields,
	requestQueryRelationships,
	requestQueryTargets,
} from '../vqlClient';
import { createMetadataStore, type MetadataStore } from './metadataStore';

/**
 * The one app-wired {@link MetadataStore} for this webview page, bound to the `vqlClient` request
 * functions and the host connection stream. Both surfaces (sidebar, popped-out tab) are separate
 * webview pages, so each gets its own singleton — the same per-page module-singleton model the rest of
 * `vqlClient` already uses. The React `QueryBuilder` reads it through `useMetadata`; the Monaco
 * `vqlCompletion` provider reads it directly.
 */
export const metadataStore: MetadataStore = createMetadataStore({
	requestTargets: requestQueryTargets,
	requestConfigurableObjects,
	requestFields: requestQueryFields,
	requestRelationships: requestQueryRelationships,
	requestPicklistFields,
	requestPicklistValues,
	onConnectionState,
});
