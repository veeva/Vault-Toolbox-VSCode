import { useState } from 'react';
import { PiCaretDown } from 'react-icons/pi';
import { isJsonContentType } from '../../core/rest/apiHistory';
import { JSON_INDENT, ReadOnlyJsonViewer } from '../editor/ReadOnlyJsonViewer';
import type { ApiHistoryEntry } from './apiHistoryClient';

type MessageDirection = 'request' | 'response';

/** Per-side open/closed state for the two collapsible sections. */
interface SideOpenState {
	headers: boolean;
	body: boolean;
}

/**
 * The expanded detail for one call. A single Request/Response toggle picks the side; that side's
 * headers and payload are shown as two labeled sections. This reads more intuitively than four
 * near-duplicate tabs and keeps the selector to two always-visible buttons.
 *
 * Open/closed state is tracked per-side so switching tabs preserves any manual expand/collapse
 * changes the user made. Response headers default to collapsed on first open.
 */
export function ApiHistoryDetail({ entry }: { entry: ApiHistoryEntry }): JSX.Element {
	const [side, setSide] = useState<MessageDirection>('response');
	const [requestOpen, setRequestOpen] = useState<SideOpenState>({ headers: true, body: true });
	const [responseOpen, setResponseOpen] = useState<SideOpenState>({ headers: false, body: true });

	const isRequest = side === 'request';
	const headers = isRequest ? entry.requestHeaders : entry.responseHeaders;
	const body = isRequest ? entry.requestBody : entry.responseBody;
	const openState = isRequest ? requestOpen : responseOpen;
	const setOpenState = isRequest ? setRequestOpen : setResponseOpen;

	return (
		<div className="vt-apihistory-detail">
			<div className="vt-seg" role="tablist" aria-label="Request or response">
				<button
					type="button"
					role="tab"
					aria-selected={isRequest}
					className={`vt-seg-btn${isRequest ? ' is-active' : ''}`}
					onClick={() => setSide('request')}
				>
					Request
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={!isRequest}
					className={`vt-seg-btn${!isRequest ? ' is-active' : ''}`}
					onClick={() => setSide('response')}
				>
					Response
				</button>
			</div>

			<CollapsibleSection
				label="Headers"
				isOpen={openState.headers}
				onToggle={() => setOpenState((prev) => ({ ...prev, headers: !prev.headers }))}
			>
				<HeaderList headers={headers} emptyMessage="No headers recorded." />
			</CollapsibleSection>

			<CollapsibleSection
				label={isRequest ? 'Payload' : 'Body'}
				isOpen={openState.body}
				onToggle={() => setOpenState((prev) => ({ ...prev, body: !prev.body }))}
			>
				<Payload
					body={body}
					isJson={isJsonContentType(headers)}
					emptyMessage={isRequest ? 'No request payload sent.' : 'No response body recorded.'}
				/>
			</CollapsibleSection>
		</div>
	);
}

/** A labeled section whose content can be toggled open or closed. */
function CollapsibleSection({
	label,
	children,
	isOpen,
	onToggle,
}: {
	label: string;
	children: React.ReactNode;
	isOpen: boolean;
	onToggle(): void;
}): JSX.Element {
	return (
		<section className="vt-apihistory-section">
			<button
				type="button"
				className="vt-apihistory-section-toggle"
				aria-expanded={isOpen}
				onClick={onToggle}
			>
				<PiCaretDown
					size={12}
					aria-hidden="true"
					className={`vt-apihistory-section-chevron${isOpen ? '' : ' is-collapsed'}`}
				/>
				<span className="vt-apihistory-section-label">{label}</span>
			</button>
			{isOpen && children}
		</section>
	);
}

function HeaderList({
	headers,
	emptyMessage,
}: {
	headers: Record<string, string>;
	emptyMessage: string;
}): JSX.Element {
	const rows = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
	if (rows.length === 0) {
		return <p className="vt-apihistory-empty-line">{emptyMessage}</p>;
	}
	return (
		<table className="vt-apihistory-headers">
			<tbody>
				{rows.map(([name, value]) => (
					<tr key={name}>
						<td className="vt-apihistory-header-name">{name}</td>
						<td className="vt-apihistory-header-value">{value}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function Payload({
	body,
	isJson,
	emptyMessage,
}: {
	body: string | null;
	isJson: boolean;
	emptyMessage: string;
}): JSX.Element {
	if (body == null || body === '') {
		return <p className="vt-apihistory-empty-line">{emptyMessage}</p>;
	}
	if (isJson) {
		const formatted = tryFormatJson(body);
		if (formatted != null) {
			return <ReadOnlyJsonViewer value={formatted} />;
		}
	}
	return <pre className="vt-json">{prettyPrint(body)}</pre>;
}

/** Indented JSON when the text parses, else `null` so the caller can fall back to plain text. */
function tryFormatJson(text: string): string | null {
	try {
		return JSON.stringify(JSON.parse(text), null, JSON_INDENT);
	} catch {
		return null;
	}
}

/** Pretty-print JSON when the text parses as such; otherwise show it verbatim. */
function prettyPrint(text: string): string {
	return tryFormatJson(text) ?? text;
}
