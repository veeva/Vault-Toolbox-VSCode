import * as vscode from 'vscode';
import { orphanedMdlFiles, planMdlFiles, relativeMdlPath } from '../../core/mdl/mdlExtraction';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import type { RunnableConnection } from '../connection/types';
import { errorMessage } from '../platform/errors';
import { deleteOrphans, scanExistingFiles } from './extractMirror';
import { resolveExtractRoot } from './extractConfirm';

/** Component-definition query backing the extraction — the fields the file layout needs, nothing more. */
const COMPONENT_QUERY =
	'SELECT component_name__v, component_type__v, mdl_definition__v FROM vault_component__v';

const DEFAULT_MDL_DIRECTORY = 'vault-toolbox/mdl';

/** Every Vault API call "Extract MDL from Vault" makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-mdl';

/**
 * "Extract MDL from Vault": confirm, then page through
 * every Vault component's MDL and write each to `<workspace>/<mdlDir>/<vaultId>/<Type>/<Type>.<name>.mdl`,
 * finally deleting local `.mdl` files that no longer exist remotely so the folder mirrors Vault.
 *
 * Requires an open workspace folder to write into. The pure file layout + orphan logic live in `core/mdl`; this owns the vscode + fs I/O.
 */
export async function extractMdlFromVault(connection: RunnableConnection): Promise<void> {
	const extractRoot = await resolveExtractRoot(connection, {
		settingKey: 'MDLDirectory',
		defaultDirectory: DEFAULT_MDL_DIRECTORY,
		extension: '.mdl',
		fileLabel: 'MDL files',
		confirmQuestion: 'Do you want to extract the MDL from Vault?',
		notConnectedMessage: 'Connect to a Vault before extracting MDL.',
		noWorkspaceFolderMessage: 'Open a project folder in VS Code to extract MDL into.',
	});
	if (!extractRoot) return;

	try {
		await runExtraction(connection, extractRoot);
	} catch (error) {
		await vscode.window.showErrorMessage(`Extract MDL failed: ${errorMessage(error)}`);
	}
}

/** Page through the component query, write each MDL file, then mirror-delete orphans. */
async function runExtraction(connection: RunnableConnection, extractRoot: vscode.Uri): Promise<void> {
	const outcome = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Extracting MDL from Vault…',
			cancellable: true,
		},
		async (progress, token) => {
			const existing = await scanExistingFiles(extractRoot, '.mdl');
			const written = await downloadAllMdl({ connection, extractRoot, progress, token });
			if (token.isCancellationRequested) {
				// A partial extraction must not drive deletion, or we'd wipe files Vault still has.
				return { cancelled: true, count: written.length };
			}
			await deleteOrphans(extractRoot, orphanedMdlFiles(existing, written));
			return { cancelled: false, count: written.length };
		},
	);

	// Report outside the progress scope: a message's promise resolves only when the toast is dismissed,
	// so awaiting one inside the callback would hold the progress notification open indefinitely.
	if (outcome.cancelled) {
		void vscode.window.showWarningMessage('Extract MDL cancelled; partial files were kept.');
		return;
	}
	void vscode.window.showInformationMessage(
		`Extracted ${outcome.count} MDL file${outcome.count === 1 ? '' : 's'} from Vault.`,
	);
	await vscode.commands.executeCommand('revealInExplorer', extractRoot);
}

/** Inputs for one extraction pass: where to read from, where to write to, and the progress handle. */
interface DownloadContext {
	connection: RunnableConnection;
	extractRoot: vscode.Uri;
	progress: vscode.Progress<{ message?: string }>;
	token: vscode.CancellationToken;
}

/** Paginate the component query, writing each MDL file; returns the written extract-relative paths. */
function downloadAllMdl(context: DownloadContext): Promise<string[]> {
	const { connection, extractRoot, progress, token } = context;
	const encoder = new TextEncoder();
	// Stream each page's MDL to disk as it arrives. Writing inside a single `connection.run` keeps an
	// INVALID_SESSION recovery restarting the whole pull; the writes are idempotent path overwrites, and
	// `written` is rebuilt per attempt so a retry never returns duplicate paths.
	return connection.run(async (client) => {
		const written: string[] = [];
		let page = 1;
		for await (const rows of client.vql.queryPages(COMPONENT_QUERY, REFERENCE_ID, {
			target: 'components',
			isCancelled: () => token.isCancellationRequested,
		})) {
			progress.report({ message: `Querying components (page ${page})…` });
			for (const file of planMdlFiles(rows)) {
				const target = vscode.Uri.joinPath(extractRoot, ...file.segments);
				await vscode.workspace.fs.writeFile(target, encoder.encode(file.content));
				written.push(relativeMdlPath(file));
			}
			page += 1;
		}
		return written;
	});
}
