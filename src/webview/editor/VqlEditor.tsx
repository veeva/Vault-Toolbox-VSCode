import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryDescribe, QueryResult } from '../../core/rest/types';
import type { PreviousResults } from '../../core/vql/builderPanelState';
import { normalizeError } from '../../shared/vqlProtocol';
import type {
	ConnectionSnapshot,
	NormalizedError,
	PaginationMeta,
	SavedQuery,
	HostToWebviewMessage,
} from '../../shared/vqlProtocol';
import { formatVql } from '../../core/vql/vqlFormat';
import {
	announceReady,
	clearHistory,
	deleteSavedQuery,
	exportCsv,
	onConnectionState,
	onHistory,
	onSavedQueries,
	queryByPage,
	runQuery,
	saveQuery,
} from '../vqlClient';
import { onHostMessage, postToHost } from '../vscodeApi';
import { getSurface } from '../shell/shellClient';
import { EditorHeader } from './EditorHeader';
import { ErrorBanner } from './ErrorBanner';
import { HistoryDropdown } from './HistoryDropdown';
import { JsonView } from './JsonView';
import { Pagination } from './Pagination';
import { QueryEditor } from './QueryEditor';
import { JSON_INDENT, ReadOnlyJsonViewer } from './ReadOnlyJsonViewer';
import type { MonacoEditorHandle } from './MonacoEditor';
import { QueryBuilder } from './builder/QueryBuilder';
import { ResultGrid } from './ResultGrid';
import { ResultMeta } from './ResultMeta';
import { SavedQueriesDropdown } from './SavedQueriesDropdown';
import { ViewToggle, type ResultViewMode } from './ViewToggle';
import { Spinner } from './Spinner';
import { DownloadIcon } from '../shell/icons';

const SAMPLE_QUERY = 'SELECT id, name__v \nFROM person__sys';

interface VqlEditorProps {
	/** When provided (sidebar surface), renders a "pop out to editor tab" action. */
	onPopOut?: () => void;
	/** Whether the editor tab is currently popped out (sidebar surface only; `TabShell` tracks this). */
	poppedOut?: boolean;
}

/**
 * The VQL Editor tab: editor → Run → grid → pagination, all round-tripped through the host bus over
 * the single live connection. Not connected → Run gated + empty-state; query failures → inline
 * banner; a stale session recovers transparently inside `connection.run()`, so this layer never sees
 * INVALID_SESSION_ID.
 */
export function VqlEditor({ onPopOut, poppedOut = false }: VqlEditorProps = {}): JSX.Element {
	const [connection, setConnection] = useState<ConnectionSnapshot>();
	const [vql, setVql] = useState(SAMPLE_QUERY);
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<QueryResult>();
	const [error, setError] = useState<NormalizedError>();
	const [exporting, setExporting] = useState(false);
	const [history, setHistory] = useState<string[]>([]);
	const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
	const [viewMode, setViewMode] = useState<ResultViewMode>('grid');
	/** Round-trip time (ms) of the last successful query/page fetch. */
	const [elapsedMs, setElapsedMs] = useState<number>();
	/** The query that produced the current grid — exported as-is, independent of later editor edits. */
	const [lastRunVql, setLastRunVql] = useState<string>();
	/** That run's target object, from its `queryDescribe` — captured once, since paging drops it. */
	const [lastRunTarget, setLastRunTarget] = useState<string>();
	/** That run's full `queryDescribe`, captured once for the same reason; feeds the grid's columns. */
	const [lastRunDescribe, setLastRunDescribe] = useState<QueryDescribe>();
	/** That run's pagination metadata from the first page, for CSV export confirmation and API call calculation. */
	const [lastRunPagination, setLastRunPagination] = useState<PaginationMeta>();
	const [restored, setRestored] = useState(false);
	const editorRef = useRef<MonacoEditorHandle>(null);

	// When transitioning back to active in the sidebar, pull fresh state from host
	useEffect(() => {
		if (getSurface() === 'panel') {
			return;
		}
		if (!poppedOut) {
			setRestored(false);
			announceReady();
		}
	}, [poppedOut]);

	// Load existing VQL state from host upon ready announcement
	useEffect(() => {
		const off = onHostMessage((message: HostToWebviewMessage) => {
			if (message.type === 'restoreState') {
				if (message.state) {
					setVql(message.state.vql);
					setResult(message.state.result);
					setElapsedMs(message.state.elapsedMs);
					setLastRunVql(message.state.lastRunVql);
					setLastRunTarget(message.state.lastRunTarget);
					setLastRunDescribe(message.state.lastRunDescribe);
					setLastRunPagination(message.state.lastRunPagination);
					setError(message.state.error);
					setViewMode(message.state.viewMode);
				}
				setRestored(true);
			}
		});
		return () => off();
	}, []);

	const canSyncState = getSurface() === 'panel' || !poppedOut;

	// Push state changes to host to synchronize across views (sidebar view and editor tab view)
	useEffect(() => {
		if (!restored || !canSyncState) {
			return;
		}
		postToHost({
			type: 'updateState',
			state: {
				vql,
				result,
				elapsedMs,
				lastRunVql,
				lastRunTarget,
				lastRunDescribe,
				lastRunPagination,
				error,
				viewMode,
			},
		});
	}, [
		restored,
		canSyncState,
		vql,
		result,
		elapsedMs,
		lastRunVql,
		lastRunTarget,
		lastRunDescribe,
		lastRunPagination,
		error,
		viewMode,
	]);

	useEffect(() => {
		const offConnection = onConnectionState(setConnection);
		const offHistory = onHistory(setHistory);
		const offSaved = onSavedQueries(setSavedQueries);
		announceReady();
		return () => {
			offConnection();
			offHistory();
			offSaved();
		};
	}, []);

	const connected = connection?.status === 'connected';

	// Run any query call, driving the in-flight/error/result state. The editor + last grid are
	// preserved on failure; a fresh success replaces the grid. Returns true on success.
	const execute = useCallback(
		async (call: () => Promise<QueryResult>): Promise<QueryResult | undefined> => {
			setRunning(true);
			setError(undefined);
			const start = Date.now();
			try {
				const queryResult = await call();
				setResult(queryResult);
				setElapsedMs(Date.now() - start);
				return queryResult;
			} catch (err) {
				setError(normalizeError(err));
				setViewMode('json');
				return undefined;
			} finally {
				setRunning(false);
			}
		},
		[],
	);

	const onRun = useCallback(() => {
		const trimmed = vql.trim();
		if (!connected || running || trimmed.length === 0) {
			return;
		}
		setResult(undefined);
		setElapsedMs(undefined);
		setLastRunVql(undefined);
		setLastRunTarget(undefined);
		setLastRunDescribe(undefined);
		setLastRunPagination(undefined);
		void execute(() => runQuery(trimmed)).then((queryResult) => {
			if (queryResult) {
				setLastRunVql(trimmed);
				setLastRunTarget(queryResult.queryDescribe?.object?.name);
				setLastRunDescribe(queryResult.queryDescribe);
				const total = queryResult.responseDetails.total;
				const pagesize = queryResult.responseDetails.pagesize;
				if (total !== undefined && pagesize !== undefined) {
					setLastRunPagination({ total, pagesize });
				}
			}
		});
	}, [connected, running, vql, execute]);

	const onPage = useCallback(
		(pageUrl: string) => {
			if (running) {
				return;
			}
			void execute(() => queryByPage(pageUrl));
		},
		[running, execute],
	);

	// Save the current query (host prompts for a name) / reformat it in place. Neither needs a
	// connection — they operate on the editor text only.
	const onSave = useCallback(() => {
		if (vql.trim().length > 0) {
			saveQuery(vql);
		}
	}, [vql]);

	const onFormat = useCallback(() => {
		setVql((current) => formatVql(current));
	}, []);

	// The Builder assembled a query — overwrite the buffer as one undoable edit and move focus to
	// Monaco at end-of-buffer. The edit fires Monaco's change event, which flows back through onChange
	// to keep `vql` (and the synced host state) in step, so no separate setVql is needed.
	const onBuildQuery = useCallback((built: string) => {
		editorRef.current?.replaceAllAndFocus(built);
	}, []);

	const rowCount = result?.data.length ?? 0;
	const canExport = connected && !running && !exporting && rowCount > 0 && !!lastRunVql;

	// The last run's object + result ids, for the builder's "filter by previous results" shortcut. The
	// object is `lastRunTarget`, captured from that run's `queryDescribe` (see its declaration — paging
	// doesn't refresh it, which is exactly why it has to be captured once rather than read off `result`
	// on every render); the ids are the `id` column of the returned rows.
	const previousResults = useMemo<PreviousResults | undefined>(() => {
		if (!result || !lastRunTarget) {
			return undefined;
		}
		const ids = result.data
			.map((row) => row.id)
			.filter((id): id is string => typeof id === 'string' && id.length > 0);
		return ids.length > 0 ? { target: lastRunTarget, ids } : undefined;
	}, [result, lastRunTarget]);

	// Export the last-run query's full result set to CSV (not the live editor text, which may have been
	// edited since). The host re-runs it, follows pagination, and shows a save dialog (defaulting to the
	// Downloads folder); a cancelled dialog resolves with no path (no message). Errors reuse the banner.
	const onExport = useCallback(() => {
		if (!canExport || !lastRunVql || !lastRunPagination) {
			return;
		}
		setExporting(true);
		setError(undefined);
		void exportCsv(lastRunVql, lastRunPagination)
			.then((exportResult) => {
				if (exportResult.error) {
					setError(exportResult.error);
				}
			})
			.finally(() => setExporting(false));
	}, [canExport, lastRunVql, lastRunPagination]);

	function renderResultView(): JSX.Element | null {
		if (viewMode === 'grid') {
			return result ? <ResultGrid result={result} describe={lastRunDescribe} /> : null;
		}
		if (result) {
			return <JsonView result={result} />;
		}
		if (error) {
			return (
				<ReadOnlyJsonViewer value={JSON.stringify(error.response || error, null, JSON_INDENT)} sizing="fill" />
			);
		}
		return null;
	}

	function renderQueryStatus(): JSX.Element {
		if (!connected) {
			return <p className="vt-hint">Connect a Vault environment to run queries.</p>;
		}
		if (running && !result) {
			return <div className="vt-placeholder">Sending request...</div>;
		}
		if (!result && !error) {
			return <></>;
		}
		return (
			<div className="vt-result-area">
				{renderResultView()}
				<div className="vt-result-controls">
					<ViewToggle mode={viewMode} onChange={setViewMode} />
					<div className="vt-result-controls-right">
						{result && (
							<Pagination details={result.responseDetails} running={running} onPage={onPage} />
						)}
						{result && <ResultMeta elapsedMs={elapsedMs} />}
					</div>
				</div>
			</div>
		);
	}

	const runDisabled = !connected || running || vql.trim().length === 0;

	return (
		<main className="vt-editor">
			<EditorHeader
				connection={connection}
				onPopOut={onPopOut}
				actionsSlot={
					<>
						<button
							type="button"
							className={`vt-btn${runDisabled ? ' disabled' : ''}`}
							onClick={runDisabled ? undefined : onRun}
							aria-disabled={runDisabled}
							data-tooltip="⌘/Ctrl+Enter"
							data-tooltip-dir="below"
						>
							{running ? (
								<span>
									<Spinner label="Running" /> Running…
								</span>
							) : (
								<span>Run VQL</span>
							)}
						</button>
						<button
							type="button"
							className="vt-header-action-btn download"
							onClick={onExport}
							disabled={!canExport || exporting}
							data-tooltip={exporting ? 'Downloading…' : 'Download CSV'}
							data-tooltip-dir="below"
						>
							{exporting ? <Spinner label="Downloading" /> : <DownloadIcon />}
						</button>
					</>
				}
			/>
			<QueryBuilder
				connection={connection}
				onBuildQuery={onBuildQuery}
				previousResults={previousResults}
			/>
			<QueryEditor
				ref={editorRef}
				value={vql}
				onChange={setVql}
				onRun={onRun}
				onFormat={onFormat}
				onSave={onSave}
				savedSlot={
					<SavedQueriesDropdown
						entries={savedQueries}
						onSelect={setVql}
						onDelete={deleteSavedQuery}
					/>
				}
				historySlot={<HistoryDropdown entries={history} onSelect={setVql} onClear={clearHistory} />}
			/>
			{error && <ErrorBanner error={error} />}
			{renderQueryStatus()}
		</main>
	);
}
