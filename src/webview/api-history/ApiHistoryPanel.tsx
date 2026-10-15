import { useEffect, useMemo, useState } from 'react';
import { statusLabel, stripOrigin } from '../../core/rest/apiHistory';
import { getSurface, requestPopOut } from '../shell/shellClient';
import { PopOutIcon } from '../shell/icons';
import { ApiHistoryList } from './ApiHistoryList';
import { ClearIcon } from './icons';
import {
	clearApiHistory,
	onApiHistory,
	requestApiHistory,
	type ApiHistoryEntry,
} from './apiHistoryClient';

/**
 * The API History tab: a live, newest-first list of every Vault API call this session, each an
 * expandable card. The host owns the log and streams it over the `apiHistory` channel; this component
 * holds the received entries, a client-side text filter, and which card is expanded.
 */
export function ApiHistoryPanel(): JSX.Element {
	const [entries, setEntries] = useState<ApiHistoryEntry[]>([]);
	const [filter, setFilter] = useState('');
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [scrollToId, setScrollToId] = useState<string | null>(null);
	const isSidebar = getSurface() === 'sidebar';

	useEffect(() => {
		const off = onApiHistory((message) => {
			if (message.type === 'snapshot') {
				setEntries(message.entries);
			} else if (message.type === 'entry') {
				setEntries((current) => [message.entry, ...current]);
			} else if (message.type === 'cleared') {
				setEntries([]);
				setExpandedId(null);
			} else if (message.type === 'reveal') {
				// Clear any filter first so a deep-linked entry can't be hidden by it, then expand it and
				// ask its row to scroll into view.
				setFilter('');
				setExpandedId(message.id);
				setScrollToId(message.id);
			}
		});
		requestApiHistory();
		return off;
	}, []);

	const visibleEntries = useMemo(() => filterEntries(entries, filter), [entries, filter]);
	const toggle = (id: string): void => setExpandedId((current) => (current === id ? null : id));

	return (
		<div className="vt-apihistory">
			<div className="vt-apihistory-bar">
				<input
					type="search"
					className="vt-apihistory-filter"
					placeholder="Filter calls…"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
				/>
				{isSidebar && (
					<button
						type="button"
						className="vt-btn icon-only secondary"
						data-tooltip="Open in Editor"
						data-tooltip-dir="below"
						aria-label="Open in Editor"
						onClick={() => requestPopOut('apiHistory')}
					>
						<PopOutIcon />
					</button>
				)}
				<button
					type="button"
					className="vt-btn icon-only secondary"
					data-tooltip="Clear history"
					data-tooltip-dir="below"
					aria-label="Clear history"
					disabled={entries.length === 0}
					onClick={clearApiHistory}
				>
					<ClearIcon />
				</button>
			</div>
			{entries.length === 0 ? (
				<div className="vt-apihistory-empty">
					<p>No API calls yet.</p>
					<p className="vt-apihistory-empty-hint">
						Calls to Vault will appear here as you use the extension.
					</p>
				</div>
			) : visibleEntries.length === 0 ? (
				<div className="vt-apihistory-empty">
					<p>No calls match “{filter.trim()}”.</p>
				</div>
			) : (
				<>
					<div className="vt-apihistory-count">
						{visibleEntries.length === entries.length
							? `${entries.length} call${entries.length === 1 ? '' : 's'}`
							: `${visibleEntries.length} of ${entries.length} calls`}
					</div>
					<ApiHistoryList
						entries={visibleEntries}
						expandedId={expandedId}
						onToggle={toggle}
						scrollToId={scrollToId}
						onScrolled={() => setScrollToId(null)}
					/>
				</>
			)}
		</div>
	);
}

function filterEntries(entries: ApiHistoryEntry[], filter: string): ApiHistoryEntry[] {
	const needle = filter.trim().toLowerCase();
	if (!needle) {
		return entries;
	}
	return entries.filter((entry) => {
		const status = statusLabel(entry.responseStatus);
		const haystack =
			`${entry.method} ${stripOrigin(entry.url)} ${status} ${entry.envLabel}`.toLowerCase();
		return haystack.includes(needle);
	});
}
