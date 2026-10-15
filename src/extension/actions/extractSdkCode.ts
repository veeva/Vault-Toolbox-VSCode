import * as vscode from 'vscode';
import {
	CUSTOM_CODE_QUERY,
	customCodeClassNames,
	NO_CUSTOM_CODE_MESSAGE,
	orphanedSdkFiles,
	type SdkDownloadFailure,
	sdkExtractionSummary,
	sourceFileSegments,
} from '../../core/sdk/sdkExtraction';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import type { RunnableConnection } from '../connection/types';
import { errorMessage } from '../platform/errors';
import { deleteOrphans, scanExistingFiles } from './extractMirror';
import { resolveExtractRoot } from './extractConfirm';

const DEFAULT_SDK_CODE_DIRECTORY = 'vault-toolbox/sdk';

/** Every Vault API call "Extract Java SDK Code from Vault" makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-sdk';

/**
 * "Extract Java SDK Code from Vault": query every custom code component's class name, retrieve each
 * class's source via `GET /code/{className}`, and write it to
 * `<workspace>/<SDKCodeDirectory>/<vaultId>/<class name with "." → "/">.java`, then reveal the folder.
 *
 * A confirm/location modal (mirroring Extract MDL) runs first: it shows the resolved target folder and,
 * when `.java` files already exist there, warns they may be deleted; **Change Location** opens the
 * `SDKCodeDirectory` setting and re-prompts. After a non-cancelled run the folder is kept a faithful
 * mirror — stale `.java` for classes no longer in Vault are deleted, but a class that merely failed to
 * download this run is preserved (ADR 0009).
 *
 * An individual class whose source GET fails is skipped, not fatal: the run records it and keeps going,
 * then reports `Extracted X of N (M failed)` with the failed class names. An empty query result says so
 * rather than succeeding silently; cancellation keeps the partial files without deleting; a total failure
 * (e.g. the name query throws) is framed as `Extract Java SDK Code failed: …`.
 *
 * Requires an open workspace folder to write into. This is read-only — nothing is written back to Vault,
 * so there is no Production guardrail. The pure package-tree layout, orphan logic, and summary messaging
 * live in `core/sdk`; this owns the vscode + fs I/O.
 */
export async function extractSdkCodeFromVault(connection: RunnableConnection): Promise<void> {
	const extractRoot = await resolveExtractRoot(connection, {
		settingKey: 'SDKCodeDirectory',
		defaultDirectory: DEFAULT_SDK_CODE_DIRECTORY,
		extension: '.java',
		fileLabel: '.java files',
		confirmQuestion: 'Do you want to extract the Java SDK code from Vault?',
		notConnectedMessage: 'Connect to a Vault before extracting Java SDK code.',
		noWorkspaceFolderMessage: 'Open a project folder in VS Code to extract Java SDK code into.',
	});
	if (!extractRoot) return;

	try {
		await runExtraction(connection, extractRoot);
	} catch (error) {
		await vscode.window.showErrorMessage(`Extract Java SDK Code failed: ${errorMessage(error)}`);
	}
}

/**
 * The terminal result of a run, before it is turned into user messaging. An `empty` name query is called
 * out rather than succeeding silently; `cancelled` keeps the partial files without deleting; otherwise the
 * run finished (possibly with per-class `failures` that were skipped, not fatal).
 */
type ExtractionOutcome =
	| { kind: 'empty' }
	| { kind: 'cancelled'; count: number }
	| { kind: 'finished'; count: number; failures: SdkDownloadFailure[] };

/** Query all custom-code class names, then retrieve and write each class's source. */
async function runExtraction(connection: RunnableConnection, extractRoot: vscode.Uri): Promise<void> {
	const outcome = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Extracting Java SDK code from Vault…',
			cancellable: true,
		},
		async (progress, token): Promise<ExtractionOutcome> => {
			const existing = await scanExistingFiles(extractRoot, '.java');
			const classNames = await queryClassNames(connection, progress, token);
			if (token.isCancellationRequested) {
				return { kind: 'cancelled', count: 0 };
			}
			if (classNames.length === 0) {
				// No custom code in Vault: don't mirror-delete (that would wipe every local .java at once);
				// just report that the run found nothing.
				return { kind: 'empty' };
			}
			const { written, failures } = await downloadSources({ connection, extractRoot, classNames, progress, token });
			if (token.isCancellationRequested) {
				// A partial extraction must not drive deletion, or we'd wipe files Vault still has.
				return { kind: 'cancelled', count: written };
			}
			// Orphans are keyed on the queried names, not the written ones, so a class that failed to
			// download this run (present in Vault, absent from the written set) is preserved (ADR 0009).
			await deleteOrphans(extractRoot, orphanedSdkFiles(existing, classNames));
			return { kind: 'finished', count: written, failures };
		},
	);

	// Report outside the progress scope: a message's promise resolves only when the toast is dismissed,
	// so awaiting one inside the callback would hold the progress notification open indefinitely.
	switch (outcome.kind) {
		case 'empty':
			void vscode.window.showInformationMessage(NO_CUSTOM_CODE_MESSAGE);
			return;
		case 'cancelled':
			// Only claim files were kept when some actually landed — cancelling during the name query (before
			// any download) leaves nothing on disk, so "partial files were kept" would be misleading there.
			void vscode.window.showWarningMessage(
				outcome.count > 0
					? 'Extract Java SDK Code cancelled; partial files were kept.'
					: 'Extract Java SDK Code cancelled.',
			);
			return;
		case 'finished':
			if (outcome.failures.length > 0) {
				// Some classes landed and some didn't: reveal what wrote, but surface the shortfall and the
				// failed class names so the developer knows the extraction was partial and what to investigate.
				// An info toast (not a warning) per the spec's Outcomes decision — the run did succeed, partly.
				void vscode.window.showInformationMessage(sdkExtractionSummary(outcome.count, outcome.failures));
			} else {
				void vscode.window.showInformationMessage(
					`Extracted ${outcome.count} Java SDK file${outcome.count === 1 ? '' : 's'} from Vault.`,
				);
			}
			await vscode.commands.executeCommand('revealInExplorer', extractRoot);
			return;
	}
}

/** Page through the custom-code name query, following `next_page`, to collect every class name. */
function queryClassNames(
	connection: RunnableConnection,
	progress: vscode.Progress<{ message?: string }>,
	token: vscode.CancellationToken,
): Promise<string[]> {
	// Collect inside a single `connection.run` so an INVALID_SESSION recovery restarts the whole pull
	// cleanly rather than double-counting names already gathered on a partial run.
	return connection.run(async (client) => {
		const names: string[] = [];
		let page = 1;
		for await (const rows of client.vql.queryPages(CUSTOM_CODE_QUERY, REFERENCE_ID, {
			isCancelled: () => token.isCancellationRequested,
		})) {
			progress.report({ message: `Querying components (page ${page})…` });
			names.push(...customCodeClassNames(rows));
			page += 1;
		}
		return names;
	});
}

/** Inputs for one download pass: the class names to fetch, where to write them, and the progress handle. */
interface DownloadContext {
	connection: RunnableConnection;
	extractRoot: vscode.Uri;
	classNames: string[];
	progress: vscode.Progress<{ message?: string }>;
	token: vscode.CancellationToken;
}

/**
 * Sequentially retrieve each class's source and write it into the package tree. A failed source GET (a
 * transient 404/5xx, or a listed component whose source isn't retrievable) is caught, recorded with its
 * reason, and skipped so one bad component doesn't abort the run; returns how many landed and which failed.
 */
async function downloadSources(context: DownloadContext): Promise<{ written: number; failures: SdkDownloadFailure[] }> {
	const { connection, extractRoot, classNames, progress, token } = context;
	const encoder = new TextEncoder();
	let written = 0;
	const failures: SdkDownloadFailure[] = [];
	for (let index = 0; index < classNames.length; index += 1) {
		if (token.isCancellationRequested) {
			break;
		}
		const className = classNames[index];
		progress.report({ message: `Downloading ${index + 1} of ${classNames.length}…` });
		try {
			const source = await connection.run((client) =>
				client.sdk.retrieveSourceCode(className, REFERENCE_ID),
			);
			const target = vscode.Uri.joinPath(extractRoot, ...sourceFileSegments(className));
			await vscode.workspace.fs.writeFile(target, encoder.encode(source));
			written += 1;
		} catch (error) {
			failures.push({ className, reason: errorMessage(error) });
		}
	}
	return { written, failures };
}
