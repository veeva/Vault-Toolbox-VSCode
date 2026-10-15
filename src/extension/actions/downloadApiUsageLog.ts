import { unzipSync } from 'fflate';
import * as vscode from 'vscode';
import { planReportFiles } from '../../core/configReport/reportArchive';
import {
	apiUsageLogDestinationSegments,
	apiUsageLogErrorMessage,
	apiUsageLogPartialFailureMessage,
	apiUsageLogRunSegments,
	encodeApiUsageLogQuery,
	type ApiUsageLogParameters,
} from '../../core/developerLogs/apiUsageLog';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import type { HostToActionsMessage } from '../../shared/actionsProtocol';
import type { RunnableConnection } from '../connection/types';
import { revealInOs, revealInOsLabel } from '../platform/revealInOs';
import { getVaultToolboxSetting } from '../platform/vscodeSettings';

/** Workspace-relative folder Developer Logs are written into unless the user overrides the setting. */
const DEFAULT_DEVELOPER_LOGS_DIRECTORY = 'vault-toolbox/logs';

/** Every Vault API call "Download API Usage Log" makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-developer-logs';

/**
 * "Download API Usage Log": for each chosen UTC day, issue a synchronous binary `GET` inside a single
 * cancellable progress notification, unzip the returned archive in process, and write the extracted
 * file(s) to `<DeveloperLogsDirectory>/<vaultId>/api-usage/<logDate>/`. The days are downloaded
 * sequentially (Vault's endpoint takes one `date` per request); when they all succeed the folder is
 * revealed — the sole date's folder for one day, the shared `api-usage` parent for several.
 *
 * Unlike the Configuration Report there is no job to submit or poll (see ADR 0008). The `fflate` unzip
 * and Zip-Slip-guarded {@link planReportFiles} are reused from the Config Report infrastructure; the
 * query encoding and on-disk layout are the pure, unit-tested `core/developerLogs` concerns. Returns the
 * result message the Actions bus posts back so the form clears its spinner and shows any failure inline.
 *
 * The `params.dates` are assumed already validated by the form; the write location is the configured
 * `DeveloperLogsDirectory` (previewed and changeable from the form). Each day is attempted
 * independently: a day that fails is recorded and the remaining days still run, with any failures
 * surfaced inline; every day written stays on disk (they are complete logs).
 */
export async function downloadApiUsageLog(
	connection: RunnableConnection,
	params: ApiUsageLogParameters,
	signal: AbortSignal,
): Promise<HostToActionsMessage> {
	const preflight = resolveRunPlan(connection, params.dates);
	if (preflight.kind === 'error') {
		return buildApiUsageLogError(preflight.message);
	}
	const { runs, destinationRoot } = preflight;

	try {
		const outcome = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Downloading API Usage Log…',
				cancellable: true,
			},
			(progress, token) =>
				runDownloads({
					connection,
					logFormat: params.logFormat,
					runs,
					destinationRoot,
					progress,
					isCancelled: () => signal.aborted || token.isCancellationRequested,
				}),
		);
		return downloadOutcome(outcome, signal);
	} catch (error) {
		// A permission denial names the missing Vault grant; any other failure carries its reason. The
		// mapping is the pure, unit-tested apiUsageLogErrorMessage so this stays a thin adapter.
		return buildApiUsageLogError(apiUsageLogErrorMessage(error));
	}
}

/**
 * Open the `vaultToolbox.DeveloperLogsDirectory` setting in the Settings editor, mirroring the Config
 * Report's "Change Location". Drives the form's change-location link.
 */
export function openDeveloperLogsSetting(): void {
	void vscode.commands.executeCommand(
		'workbench.action.openSettings',
		'vaultToolbox.DeveloperLogsDirectory',
	);
}

/**
 * The workspace-relative folder API Usage Logs are saved under (`<logsDirectory>/<vaultId>/api-usage`;
 * each download adds a `<logDate>` subfolder), for the form's write-location preview. Undefined when
 * there is no connection, Vault id, or workspace to resolve one — the form then omits the preview.
 */
export function apiUsageLogDestinationLabel(connection: RunnableConnection): string | undefined {
	const resolved = resolveRunContext(connection);
	if (resolved.kind === 'error') {
		return undefined;
	}
	const { logsDirectory, vaultId } = resolved.context;
	return [logsDirectory, ...apiUsageLogDestinationSegments(vaultId)].join('/');
}

/** One chosen day paired with the folder its extracted log is written under. */
interface DateRun {
	date: string;
	runRoot: vscode.Uri;
}

/**
 * Either the resolved plan for a multi-date download — a per-day folder for each chosen date plus the
 * shared `api-usage` parent to reveal when several days succeed — or the error to surface when
 * preconditions aren't met.
 */
type RunPlan =
	| { kind: 'ready'; runs: DateRun[]; destinationRoot: vscode.Uri }
	| { kind: 'error'; message: string };

/** The workspace folder + resolved logs directory + Vault id an API Usage Log download writes under. */
interface RunContext {
	workspaceFolder: vscode.WorkspaceFolder;
	logsDirectory: string;
	vaultId: string;
}

/** Validate the connection + workspace and resolve the pieces of a download's output location. */
function resolveRunContext(
	connection: RunnableConnection,
): { kind: 'ready'; context: RunContext } | { kind: 'error'; message: string } {
	const state = connection.getState();
	if (state.status !== 'connected' || !state.info) {
		return { kind: 'error', message: 'Connect to a Vault before downloading the API Usage Log.' };
	}
	if (state.info.vaultId === undefined) {
		return { kind: 'error', message: 'Cannot determine the connected Vault ID; reconnect and retry.' };
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return {
			kind: 'error',
			message: 'Open a project folder in VS Code to download the API Usage Log into.',
		};
	}
	// See getVaultToolboxSetting for why this key is `DeveloperLogsDirectory`, not camelCase.
	const logsDirectory = getVaultToolboxSetting('DeveloperLogsDirectory', DEFAULT_DEVELOPER_LOGS_DIRECTORY);
	return {
		kind: 'ready',
		context: { workspaceFolder, logsDirectory, vaultId: String(state.info.vaultId) },
	};
}

/** Validate the connection + workspace and compute each chosen day's output folder, or an error to surface. */
function resolveRunPlan(connection: RunnableConnection, dates: string[]): RunPlan {
	const resolved = resolveRunContext(connection);
	if (resolved.kind === 'error') {
		return resolved;
	}
	const { workspaceFolder, logsDirectory, vaultId } = resolved.context;
	const runs = dates.map((date) => ({
		date,
		runRoot: vscode.Uri.joinPath(
			workspaceFolder.uri,
			logsDirectory,
			...apiUsageLogRunSegments(vaultId, date),
		),
	}));
	const destinationRoot = vscode.Uri.joinPath(
		workspaceFolder.uri,
		logsDirectory,
		...apiUsageLogDestinationSegments(vaultId),
	);
	return { kind: 'ready', runs, destinationRoot };
}

/**
 * The terminal result of a download, before it is turned into user messaging. `revealRoot` is the folder
 * to open for the days that wrote (the sole day's folder when only one wrote, else the shared `api-usage`
 * parent). A multi-date download can partly succeed — each day is attempted independently — so the outcome
 * distinguishes all-written, all-failed, and partial; `error` on the failing variants is the first failure,
 * which drives the permission-aware messaging.
 */
type DownloadOutcome =
	| { kind: 'written'; revealRoot: vscode.Uri; count: number }
	| { kind: 'partial'; revealRoot: vscode.Uri; okCount: number; failedDates: string[]; error: unknown }
	| { kind: 'failed'; error: unknown }
	| { kind: 'cancelled' };

interface RunDownloadsContext {
	connection: RunnableConnection;
	logFormat: ApiUsageLogParameters['logFormat'];
	runs: DateRun[];
	destinationRoot: vscode.Uri;
	progress: vscode.Progress<{ message?: string }>;
	isCancelled: () => boolean;
}

/**
 * Download → unzip → write each chosen day in turn, reporting per-day progress and honouring cancellation
 * between and within days. Each day is attempted independently: a day that fails is recorded and the rest
 * still run, so one bad day (e.g. a date Vault has no log for) doesn't discard the others. Reveals the sole
 * day's folder when one day wrote, or the shared `api-usage` parent when several did.
 */
async function runDownloads(context: RunDownloadsContext): Promise<DownloadOutcome> {
	const { connection, logFormat, runs, destinationRoot, progress, isCancelled } = context;
	const total = runs.length;
	const written: DateRun[] = [];
	const failedDates: string[] = [];
	let firstError: unknown;

	for (const [index, run] of runs.entries()) {
		if (isCancelled()) {
			return { kind: 'cancelled' };
		}
		const step = total === 1 ? '' : ` (${index + 1} of ${total})`;
		try {
			progress.report({ message: `Downloading ${run.date} from Vault…${step}` });
			const query = encodeApiUsageLogQuery(run.date, logFormat);
			const zipBytes = await connection.run((client) =>
				client.logs.downloadApiUsageLog(query, REFERENCE_ID),
			);
			if (isCancelled()) {
				return { kind: 'cancelled' };
			}
			progress.report({ message: `Extracting ${run.date}…${step}` });
			const files = planReportFiles(unzipSync(zipBytes));
			await writeFiles(run.runRoot, files);
			written.push(run);
		} catch (error) {
			if (firstError === undefined) {
				firstError = error;
			}
			failedDates.push(run.date);
		}
	}

	const revealRoot = written.length === 1 ? written[0].runRoot : destinationRoot;
	if (failedDates.length === 0) {
		return { kind: 'written', revealRoot, count: written.length };
	}
	if (written.length === 0) {
		return { kind: 'failed', error: firstError };
	}
	return { kind: 'partial', revealRoot, okCount: written.length, failedDates, error: firstError };
}

/**
 * Write the extracted files, refreshing the date folder in place: clear any prior download for the same
 * date first (e.g. a different format's file) so re-downloading overwrites rather than accumulates, then
 * write the fresh files (which recreates the folder), keeping a log date a refresh rather than a snapshot.
 */
async function writeFiles(
	runRoot: vscode.Uri,
	files: ReadonlyArray<{ relativePath: string; content: Uint8Array }>,
): Promise<void> {
	try {
		await vscode.workspace.fs.delete(runRoot, { recursive: true, useTrash: false });
	} catch {
		// No prior download for this date — nothing to clear; the writes below create the folder.
	}
	for (const file of files) {
		const target = vscode.Uri.joinPath(runRoot, ...file.relativePath.split('/'));
		await vscode.workspace.fs.writeFile(target, file.content);
	}
}

/** Turn a download's outcome into the user-facing toast and the message the bus posts back to the form. */
function downloadOutcome(outcome: DownloadOutcome, signal: AbortSignal): HostToActionsMessage {
	switch (outcome.kind) {
		case 'written':
			void revealAndAnnounce(outcome.revealRoot, outcome.count);
			return { type: 'apiUsageLogResult', status: 'success' };
		case 'partial':
			// Some days landed and some didn't: reveal what wrote, but surface the shortfall inline so the
			// user stays on the form and can retry only the failed days.
			void vscode.commands.executeCommand('revealInExplorer', outcome.revealRoot);
			return buildApiUsageLogError(
				apiUsageLogPartialFailureMessage(outcome.okCount, outcome.failedDates, outcome.error),
			);
		case 'failed':
			return buildApiUsageLogError(apiUsageLogErrorMessage(outcome.error));
		case 'cancelled':
			// Suppress the toast when Back drove the cancel (the form already left the screen); announce
			// only a notification-driven cancel.
			if (!signal.aborted) {
				void vscode.window.showInformationMessage('API Usage Log download cancelled.');
			}
			return { type: 'apiUsageLogResult', status: 'success' };
	}
}

/**
 * Reveal the download folder in the Explorer and show the completion toast, offering a Reveal-in-Finder
 * action that opens the folder in the OS file manager — mirroring the Configuration Report toast.
 */
async function revealAndAnnounce(runRoot: vscode.Uri, count: number): Promise<void> {
	await vscode.commands.executeCommand('revealInExplorer', runRoot);
	const reveal = revealInOsLabel();
	const message = count === 1 ? 'API Usage Log downloaded.' : `${count} API Usage Logs downloaded.`;
	void vscode.window
		.showInformationMessage(message, reveal)
		.then((choice) => (choice === reveal ? revealInOs(runRoot) : undefined));
}

/** Build the error result the bus posts back so the form surfaces it inline. */
function buildApiUsageLogError(message: string): HostToActionsMessage {
	return { type: 'apiUsageLogResult', status: 'error', errorMessage: message };
}
