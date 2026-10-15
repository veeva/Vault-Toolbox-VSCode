import type { QueryResponseDetails } from '../../core/rest/types';
import { pageRangeLabel } from '../../core/vql/resultGrid';

interface Props {
	details: QueryResponseDetails;
	running: boolean;
	onPage(pageUrl: string): void;
}

/**
 * Prev/Next pager + a range label ("1–200 of 4213"). Buttons gate strictly on token presence — some
 * query targets (workflows/events/users) return no pagination URLs, so absence means "no page",
 * never "assume it exists". Following a page is a POST driven by the host (offset is in the URL).
 */
export function Pagination({ details, running, onPage }: Props): JSX.Element {
	const previous = details.previousPage;
	const next = details.nextPage;
	const range = pageRangeLabel(details);
	return (
		<div className="vt-pager">
			<button
				type="button"
				className="vt-btn secondary"
				disabled={running || !previous}
				onClick={() => previous && onPage(previous)}
			>
				‹ Prev
			</button>
			{range && <span className="vt-page-chip">{range}</span>}
			<button
				type="button"
				className="vt-btn secondary"
				disabled={running || !next}
				onClick={() => next && onPage(next)}
			>
				Next ›
			</button>
		</div>
	);
}
