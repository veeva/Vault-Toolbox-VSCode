/**
 * Pure query-history logic for the VQL Editor: most-recently-run first, exact-duplicate entries moved 
 * to the front (never duplicated), capped at {@link MAX_HISTORY}. Kept vscode-free so it can be unit-tested
 * and reused by the globalState store.
 */

/** Maximum number of remembered queries. */
export const MAX_HISTORY = 25;

/**
 * Return a new history list with `vql` promoted to the front. A blank query is ignored (the list is
 * returned unchanged). An existing identical entry is moved to the front rather than duplicated, and
 * the list is trimmed from the tail to `cap`.
 */
export function addToHistory(history: readonly string[], vql: string, cap = MAX_HISTORY): string[] {
	const trimmed = vql.trim();
	if (trimmed.length === 0) {
		return [...history];
	}
	const next = history.filter((entry) => entry !== trimmed);
	next.unshift(trimmed);
	return next.slice(0, cap);
}
