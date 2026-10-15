/**
 * Compact result metadata beside the pager: the round-trip time of the last query/page fetch. The
 * record range + total already show in the pagination label, so this stays complementary rather than
 * repeating them.
 */
export function ResultMeta({ elapsedMs }: { elapsedMs?: number }): JSX.Element | null {
	if (elapsedMs === undefined) {
		return null;
	}
	return <span className="vt-meta">{`${elapsedMs} ms`}</span>;
}
