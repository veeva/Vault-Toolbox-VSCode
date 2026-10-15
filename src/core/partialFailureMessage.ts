/**
 * Shared formatter for "some items succeeded, some failed" messaging, used by the extract and
 * download actions. Covers two structural variants:
 *
 * - **Format A** (log downloads): `"Downloaded X of Y logs. Couldn’t download N day/days (list): reason"`
 * - **Format B** (SDK extraction): `"Extracted X of Y (N failed). Couldn’t download list: reason"`
 *
 * The variant is selected by whether `failedItemNoun` is supplied. Pure and transport-free so it is
 * unit-testable in isolation.
 */

/** Options that vary between call sites: the verb, collective noun, and per-item noun. */
export interface PartialFailureOptions {
	/** Verb for the success side: `"Downloaded"` or `"Extracted"`. */
	successVerb: string;
	/** Collective noun appended after the ok/total count, when present: `"logs"`. Absent → no word. */
	successNoun?: string;
	/**
	 * Singular noun for a failed item: `"day"`.
	 * Present → Format A: `"${verb} ${ok} of ${total}[ ${noun}]. Couldn’t download ${n} ${itemNoun(s)} (${list}): ${reason}"`
	 * Absent  → Format B: `"${verb} ${ok} of ${total} (${n} failed). Couldn’t download ${list}: ${reason}"`
	 */
	failedItemNoun?: string;
}

/**
 * Format a partial-failure message: some items succeeded, some failed.
 *
 * Returns an empty string when `failedLabels` is empty — callers guarantee a non-empty list; this
 * is a safe no-crash guard rather than a meaningful output.
 */
export function partialFailureMessage(
	okCount: number,
	failedLabels: string[],
	reason: string,
	opts: PartialFailureOptions,
): string {
	if (failedLabels.length === 0) {
		return '';
	}

	const total = okCount + failedLabels.length;
	const n = failedLabels.length;
	const list = failedLabels.join(', ');
	const countPhrase = opts.successNoun ? `${okCount} of ${total} ${opts.successNoun}` : `${okCount} of ${total}`;

	if (opts.failedItemNoun !== undefined) {
		// Format A: "Downloaded X of Y logs. Couldn’t download N day/days (list): reason"
		const noun = n === 1 ? opts.failedItemNoun : `${opts.failedItemNoun}s`;
		return `${opts.successVerb} ${countPhrase}. Couldn’t download ${n} ${noun} (${list}): ${reason}`;
	}

	// Format B: "Extracted X of Y (N failed). Couldn’t download list: reason"
	return `${opts.successVerb} ${countPhrase} (${n} failed). Couldn’t download ${list}: ${reason}`;
}
