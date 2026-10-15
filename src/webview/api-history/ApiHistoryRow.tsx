import { useEffect, useRef } from 'react';
import {
	formatDateTime,
	formatDuration,
	methodClass,
	statusClass,
	statusLabel,
	stripOrigin,
} from '../../core/rest/apiHistory';
import { ApiHistoryDetail } from './ApiHistoryDetail';
import type { ApiHistoryEntry } from './apiHistoryClient';

interface ApiHistoryRowProps {
	entry: ApiHistoryEntry;
	expanded: boolean;
	onToggle(): void;
	/** When true, this row scrolls itself into view once (a host-driven reveal). */
	scrollIntoView: boolean;
	/** Called after this row has scrolled into view, so the parent can clear the reveal target. */
	onScrolled(): void;
}

/**
 * One call as a compact two-line card: the method + endpoint + status on top, secondary metadata
 * (time · duration · environment) below, with the expandable request/response detail underneath. A
 * card list reads far better than a wide table in the narrow sidebar (the endpoint stays visible).
 */
export function ApiHistoryRow({
	entry,
	expanded,
	onToggle,
	scrollIntoView,
	onScrolled,
}: ApiHistoryRowProps): JSX.Element {
	const endpoint = stripOrigin(entry.url);
	const status = statusLabel(entry.responseStatus);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollIntoView) {
			ref.current?.scrollIntoView({ block: 'nearest' });
			onScrolled();
		}
	}, [scrollIntoView, onScrolled]);

	return (
		<div ref={ref} className={`vt-apihistory-item${expanded ? ' is-expanded' : ''}`}>
			<div
				className="vt-apihistory-summary"
				role="button"
				tabIndex={0}
				aria-expanded={expanded}
				onClick={onToggle}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						onToggle();
					}
				}}
			>
				<div className="vt-apihistory-primary">
					<span className={`vt-badge vt-method-${methodClass(entry.method)}`}>{entry.method}</span>
					<span className="vt-apihistory-endpoint" title={endpoint}>
						{endpoint}
					</span>
					<span
						className={`vt-badge vt-status-${statusClass(entry.responseStatus)}`}
						title={entry.error?.message}
					>
						{status}
					</span>
				</div>
				<div className="vt-apihistory-meta">
					<span>{formatDateTime(entry.timestamp)}</span>
					<span className="vt-apihistory-dot">·</span>
					<span>{formatDuration(entry.durationMs)}</span>
					<span className="vt-apihistory-dot">·</span>
					<span className="vt-apihistory-env" title={entry.envLabel}>
						{entry.envLabel}
					</span>
				</div>
			</div>
			{expanded && <ApiHistoryDetail entry={entry} />}
		</div>
	);
}
