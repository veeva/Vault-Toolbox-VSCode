import { unzipSync } from 'fflate';
import * as vscode from 'vscode';
import { pollJob, type PollOutcome } from '../../core/job/pollJob';
import { selectReportArtifacts } from '../../core/configReport/reportArtifacts';
import {
	hrefBasename,
	planReportFiles,
	runFolderSegment,
	sanitizeEntryPath,
} from '../../core/configReport/reportArchive';
import {
	encodeConfigReportBody,
	type ConfigReportParameters,
} from '../../core/configReport/reportParameters';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import type { HostToActionsMessage } from '../../shared/actionsProtocol';
import type { RunnableConnection } from '../connection/types';
import { errorMessage } from '../platform/errors';
import { revealInOs, revealInOsLabel } from '../platform/revealInOs';
import { getVaultToolboxSetting } from '../platform/vscodeSettings';

/** Workspace-relative folder the report is written into unless the user overrides the setting. */
const DEFAULT_CONFIG_REPORT_DIRECTORY = 'vault-toolbox/config';

/** Fallback filename for the CSV error log when its download href carries no usable filename. */
const DEFAULT_ERROR_LOG_NAME = 'error_log.csv';

/** Every Vault API call "Download Vault Configuration Report" makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-config-report';

/**
 * "Download Vault Configuration Report": submit the report job with the chosen parameters, poll it to
 * completion inside a cancellable progress notification, then download the ZIP artifact, unzip it in
 * process, and write the extracted report (plus the CSV error log on config issues) to
 * `<ConfigReportDirectory>/<vaultId>/<timestamp>/`, revealing the run folder when done.
 *
 * The pure concerns — parameter encoding, job-status decisions, and Zip-Slip-guarded destination
 * planning — live in `core/configReport`; this owns the vscode + fs I/O. Returns the result message the
 * Actions bus posts back so the form clears its spinner and shows any failure inline.
 */
export async function downloadConfigReport(
	connection: RunnableConnection,
	params: ConfigReportParameters,
	signal: AbortSignal,
): Promise<HostToActionsMessage> {
	const preflight = resolveRunRoot(connection);
	if (preflight.kind === 'error') {
		return configReportError(preflight.message);
	}
	const runRoot = preflight.runRoot;

	try {
		const outcome = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Downloading Vault Configuration Report…',
				cancellable: true,
			},
			(progress, token) =>
				runReport({
					connection,
					params,
					runRoot,
					progress,
					isCancelled: () => signal.aborted || token.isCancellationRequested,
				}),
		);
		return reportOutcome(outcome, signal);
	} catch (error) {
		return configReportError(`Download Configuration Report failed: ${errorMessage(error)}`);
	}
}

/**
 * Open the `vaultToolbox.ConfigReportDirectory` setting in the Settings editor, mirroring how Extract
 * MDL's "Change Location" deep-links to its own directory setting. Drives the form's "change save
 * location" link.
 */
export function openConfigReportSetting(): void {
	void vscode.commands.executeCommand('workbench.action.openSettings', 'vaultToolbox.ConfigReportDirectory');
}

/** Either the resolved per-run output folder, or the error to surface when preconditions aren't met. */
type RunRoot = { kind: 'ready'; runRoot: vscode.Uri } | { kind: 'error'; message: string };

/** The workspace folder + resolved config directory + Vault id a report run writes under. */
interface RunContext {
	workspaceFolder: vscode.WorkspaceFolder;
	configDirectory: string;
	vaultId: string;
}

/** Validate the connection + workspace and resolve the pieces of a report's output location. */
function resolveRunContext(
	connection: RunnableConnection,
): { kind: 'ready'; context: RunContext } | { kind: 'error'; message: string } {
	const state = connection.getState();
	if (state.status !== 'connected' || !state.info) {
		return { kind: 'error', message: 'Connect to a Vault before downloading a Configuration Report.' };
	}
	if (state.info.vaultId === undefined) {
		return { kind: 'error', message: 'Cannot determine the connected Vault ID; reconnect and retry.' };
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return {
			kind: 'error',
			message: 'Open a project folder in VS Code to download the Configuration Report into.',
		};
	}
	// See getVaultToolboxSetting for why this key is `ConfigReportDirectory`, not camelCase.
	const configDirectory = getVaultToolboxSetting('ConfigReportDirectory', DEFAULT_CONFIG_REPORT_DIRECTORY);
	return {
		kind: 'ready',
		context: { workspaceFolder, configDirectory, vaultId: String(state.info.vaultId) },
	};
}

/** Validate the connection + workspace and compute the per-run output folder, or an error to surface. */
function resolveRunRoot(connection: RunnableConnection): RunRoot {
	const resolved = resolveRunContext(connection);
	if (resolved.kind === 'error') {
		return resolved;
	}
	const { workspaceFolder, configDirectory, vaultId } = resolved.context;
	const runRoot = vscode.Uri.joinPath(
		workspaceFolder.uri,
		configDirectory,
		vaultId,
		runFolderSegment(new Date()),
	);
	return { kind: 'ready', runRoot };
}

/**
 * The workspace-relative folder reports are saved under (`<configDirectory>/<vaultId>`; each run adds a
 * timestamped subfolder), for the form's write-location preview. Undefined when there is no connection,
 * Vault id, or workspace to resolve one — the form then simply omits the preview.
 */
export function configReportDestinationLabel(connection: RunnableConnection): string | undefined {
	const resolved = resolveRunContext(connection);
	if (resolved.kind === 'error') {
		return undefined;
	}
	return [resolved.context.configDirectory, resolved.context.vaultId].join('/');
}

/** The terminal result of one report run, before it is turned into user messaging. */
type ReportOutcome =
	| { kind: 'written'; runRoot: vscode.Uri; fileCount: number; hadIssues: boolean; errorLogName?: string }
	| { kind: 'error'; message: string }
	| { kind: 'graceful-timeout' }
	| { kind: 'cancelled' };

interface RunReportContext {
	connection: RunnableConnection;
	params: ConfigReportParameters;
	runRoot: vscode.Uri;
	progress: vscode.Progress<{ message?: string }>;
	isCancelled: () => boolean;
}

/** Submit → poll → download → unzip → write, reporting progress and honouring cancellation throughout. */
async function runReport(context: RunReportContext): Promise<ReportOutcome> {
	const { connection, params, progress, isCancelled } = context;

	progress.report({ message: 'Submitting report job…' });
	const jobId = await connection.run((client) =>
		client.job.submitConfigReport(encodeConfigReportBody(params), REFERENCE_ID),
	);

	const polled = await pollJob(
		() =>
			connection.run((client) =>
				client.job.retrieveJobStatus(jobId, REFERENCE_ID),
			),
		{ isCancelled, onTick: () => progress.report({ message: 'Generating report in Vault…' }) },
	);
	const shortCircuit = pollOutcomeToReport(polled);
	if (shortCircuit) {
		return shortCircuit;
	}
	const succeeded = polled as Extract<PollOutcome, { kind: `succeeded${string}` }>;

	const artifacts = selectReportArtifacts(succeeded.status.links);
	const reportHref = artifacts.reportHref;
	if (!reportHref) {
		return { kind: 'error', message: 'The report job finished but returned no downloadable report.' };
	}

	progress.report({ message: 'Downloading report…' });
	const zipBytes = await connection.run((client) =>
		client.job.downloadJobArtifact(reportHref, REFERENCE_ID),
	);
	if (isCancelled()) {
		return { kind: 'cancelled' };
	}

	progress.report({ message: 'Extracting report…' });
	const files = planReportFiles(unzipSync(zipBytes));
	await writeFiles(context.runRoot, files);

	const hadIssues = succeeded.kind === 'succeeded-with-issues';
	const errorLogName =
		hadIssues && artifacts.errorLogHref
			? await saveErrorLog(context, artifacts.errorLogHref)
			: undefined;

	return {
		kind: 'written',
		runRoot: context.runRoot,
		fileCount: files.length,
		hadIssues,
		errorLogName,
	};
}

/** Map the non-success poll outcomes onto a run outcome; returns undefined when the job is ready to download. */
function pollOutcomeToReport(outcome: PollOutcome): ReportOutcome | undefined {
	switch (outcome.kind) {
		case 'failed':
			return { kind: 'error', message: `The report job did not complete (status ${outcome.status}).` };
		case 'graceful-timeout':
			return { kind: 'graceful-timeout' };
		case 'cancelled':
			return { kind: 'cancelled' };
		default:
			return undefined;
	}
}

/** Write each planned file under the run folder, creating parent folders implicitly. */
async function writeFiles(
	runRoot: vscode.Uri,
	files: ReadonlyArray<{ relativePath: string; content: Uint8Array }>,
): Promise<void> {
	for (const file of files) {
		const target = vscode.Uri.joinPath(runRoot, ...file.relativePath.split('/'));
		await vscode.workspace.fs.writeFile(target, file.content);
	}
}

/** Download and write the CSV error log into the run folder; returns the filename it was saved as. */
async function saveErrorLog(context: RunReportContext, errorLogHref: string): Promise<string> {
	const csvBytes = await context.connection.run((client) =>
		client.job.downloadJobArtifact(errorLogHref, REFERENCE_ID),
	);
	const name = errorLogFilename(errorLogHref);
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(context.runRoot, name), csvBytes);
	return name;
}

/** The filename to save the error log under: the href's own basename when safe, else a stable default. */
function errorLogFilename(href: string): string {
	return sanitizeEntryPath(hrefBasename(href)) ?? DEFAULT_ERROR_LOG_NAME;
}

/** Turn a run's outcome into the user-facing toast(s) and the message the bus posts back to the form. */
function reportOutcome(outcome: ReportOutcome, signal: AbortSignal): HostToActionsMessage {
	switch (outcome.kind) {
		case 'written':
			void revealAndAnnounce(outcome);
			return { type: 'configReportResult', status: 'success' };
		case 'graceful-timeout':
			void vscode.window.showInformationMessage(
				'The Configuration Report is still generating in Vault. You will receive an in-app Vault ' +
					'notification with the download link when it completes.',
			);
			return { type: 'configReportResult', status: 'success' };
		case 'cancelled':
			// Suppress the toast when Back drove the cancel (the form already left the screen); announce
			// only a notification-driven cancel.
			if (!signal.aborted) {
				void vscode.window.showInformationMessage('Configuration Report download cancelled.');
			}
			return { type: 'configReportResult', status: 'success' };
		case 'error':
			return configReportError(outcome.message);
	}
}

/**
 * Reveal the run folder in the Explorer and show the completion toast (a warning when config issues
 * were found), offering a Reveal-in-Finder action that opens the run folder in the OS file manager —
 * mirroring the VQL export toast.
 */
async function revealAndAnnounce(
	outcome: Extract<ReportOutcome, { kind: 'written' }>,
): Promise<void> {
	await vscode.commands.executeCommand('revealInExplorer', outcome.runRoot);

	const reveal = revealInOsLabel();
	const show = outcome.hadIssues
		? () => {
				const where = outcome.errorLogName
					? ` The error log was saved as ${outcome.errorLogName}.`
					: '';
				return vscode.window.showWarningMessage(
					`Configuration Report downloaded, but Vault reported configuration issues.${where}`,
					reveal,
				);
			}
		: () => vscode.window.showInformationMessage('Configuration Report downloaded.', reveal);
	void show().then((choice) => (choice === reveal ? revealInOs(outcome.runRoot) : undefined));
}

/** Build the error result the bus posts back so the form surfaces it inline. */
function configReportError(message: string): HostToActionsMessage {
	return { type: 'configReportResult', status: 'error', errorMessage: message };
}
