import type { ApiHistoryEntry } from './apiHistoryClient';
import { ApiHistoryRow } from './ApiHistoryRow';

interface ApiHistoryListProps {
	entries: ApiHistoryEntry[];
	expandedId: string | null;
	onToggle(id: string): void;
	/** The entry to scroll into view (a host-driven reveal), or `null` for none. */
	scrollToId: string | null;
	/** Called once the `scrollToId` row has scrolled itself into view, so the parent can reset it. */
	onScrolled(): void;
}

/** The newest-first list of call cards; each row owns its own expandable detail. */
export function ApiHistoryList({
	entries,
	expandedId,
	onToggle,
	scrollToId,
	onScrolled,
}: ApiHistoryListProps): JSX.Element {
	return (
		<div className="vt-apihistory-list">
			{entries.map((entry) => (
				<ApiHistoryRow
					key={entry.id}
					entry={entry}
					expanded={entry.id === expandedId}
					onToggle={() => onToggle(entry.id)}
					scrollIntoView={entry.id === scrollToId}
					onScrolled={onScrolled}
				/>
			))}
		</div>
	);
}
