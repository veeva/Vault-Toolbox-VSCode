import type { VaultPicklistSummary } from '../rest/types';

/**
 * Pure reverse-map from Retrieve All Picklists to a field→picklistName lookup, kept DOM-free so it is
 * shared by the host `MetadataService` and unit-tested in isolation. A field's picklist-ness is
 * decided by presence in this index (authoritative), not by a `SHOW FIELDS` type string — the one
 * documented REST exception to the VQL Builder's "SHOW everywhere" charter.
 *
 * Shape: container (object API name or document type name) → (field name → picklist name). The nested
 * map makes a per-container projection (the slice the WHERE builder needs for one `FROM` target) O(1),
 * while a single `(container, field)` lookup stays a two-step get.
 */
export type PicklistFieldIndex = ReadonlyMap<string, ReadonlyMap<string, string>>;

/**
 * Build the field→picklistName index from the raw picklist list. Each picklist's `usedIn[]` entry maps
 * its container (`objectName` for object picklists, `documentTypeName` for document picklists) and
 * `propertyName` (the field that uses it) back to the picklist `name`. Entries missing a container or
 * property are skipped; a later usage for the same `(container, field)` overwrites an earlier one
 * (Vault should not report a field twice, but last-wins keeps the map single-valued regardless).
 */
export function buildPicklistFieldIndex(
	picklists: readonly VaultPicklistSummary[],
): PicklistFieldIndex {
	const index = new Map<string, Map<string, string>>();
	for (const picklist of picklists) {
		if (!picklist.name) {
			continue;
		}
		for (const usage of picklist.usedIn) {
			const container = usage.objectName ?? usage.documentTypeName;
			if (!container || !usage.propertyName) {
				continue;
			}
			let fields = index.get(container);
			if (!fields) {
				fields = new Map();
				index.set(container, fields);
			}
			fields.set(usage.propertyName, picklist.name);
		}
	}
	return index;
}

/** The picklist name a `container`'s `field` uses, or `undefined` when the field is not a picklist. */
export function picklistNameForField(
	index: PicklistFieldIndex,
	container: string,
	field: string,
): string | undefined {
	return index.get(container)?.get(field);
}

/** Project the index to a plain `field → picklistName` record for one container — the slice the
 *  webview WHERE builder needs for its `FROM` target. Empty when the container has no picklist fields. */
export function picklistFieldsForContainer(
	index: PicklistFieldIndex,
	container: string,
): Record<string, string> {
	const fields = index.get(container);
	return fields ? Object.fromEntries(fields) : {};
}
