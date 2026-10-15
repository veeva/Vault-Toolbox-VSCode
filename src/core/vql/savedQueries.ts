/**
 * Pure saved-query logic for the VQL Editor: named queries the user keeps deliberately (unlike the
 * auto-recorded, capped history). Most-recently-saved first; saving under an existing name replaces
 * that entry (moved to the front) rather than duplicating it. Kept vscode-free so it can be
 * unit-tested and reused by the globalState store.
 */

/** A user-named VQL query. */
export interface SavedQuery {
	name: string;
	vql: string;
}

/**
 * Return a new list with `{name, vql}` promoted to the front. A blank name or query is ignored (the
 * list is returned unchanged). An existing entry with the same (trimmed) name is replaced rather than
 * duplicated. There is no cap — saved queries are intentional, not a recency buffer.
 */
export function addSavedQuery(
	list: readonly SavedQuery[],
	name: string,
	vql: string,
): SavedQuery[] {
	const trimmedName = name.trim();
	const trimmedVql = vql.trim();
	if (trimmedName.length === 0 || trimmedVql.length === 0) {
		return [...list];
	}
	const next = list.filter((entry) => entry.name !== trimmedName);
	next.unshift({ name: trimmedName, vql: trimmedVql });
	return next;
}

/**
 * Report whether saving under `name` would overwrite an existing entry. Uses the same trimmed,
 * case-sensitive match as {@link addSavedQuery} so a caller's "you're about to overwrite" hint can't
 * drift from what a save actually does. A blank name never matches.
 */
export function savedQueryExists(list: readonly SavedQuery[], name: string): boolean {
	const trimmedName = name.trim();
	return trimmedName.length > 0 && list.some((entry) => entry.name === trimmedName);
}

/** Return a new list with the entry named `name` removed (no-op when absent). */
export function removeSavedQuery(list: readonly SavedQuery[], name: string): SavedQuery[] {
	return list.filter((entry) => entry.name !== name);
}
