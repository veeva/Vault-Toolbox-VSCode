import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ObservableConnection } from '../connection/types';
import type { MetadataService } from '../metadata/metadataService';
import type { QueryHistoryStore } from '../storage/queryHistoryStore';
import type { SavedQueryStore } from '../storage/savedQueryStore';
import type { PopOutTab, ShellSurface } from '../../shared/shellProtocol';
import type { HostToWebviewMessage, VqlEditorState } from '../../shared/vqlProtocol';
import { VqlBus, type ExportMeta } from './vqlBus';
import { buildVqlHtml, makeNonce } from './vqlHtml';
import { revealInOs, revealInOsLabel } from '../platform/revealInOs';
import { savedQueryExists } from '../../core/vql/savedQueries';

export interface VqlStateStore {
	get(): VqlEditorState | undefined;
	set(state: VqlEditorState): void;
}

/** Deps the bus needs from the extension host; both surfaces pass the same set. */
export interface VqlHostDeps {
	connection: ObservableConnection;
	history: QueryHistoryStore;
	metadata: MetadataService;
	savedQueries: SavedQueryStore;
	stateStore: VqlStateStore;
}

/**
 * Build the nonce'd, strict-CSP HTML shell that loads the esbuild-bundled React app from
 * `dist/webview/`. Takes a `vscode.Webview` (not a panel) so it serves both `panel.webview` and
 * `view.webview` — both expose `cspSource` + `asWebviewUri`.
 *
 * Monaco needs extra allowances: `worker-src blob:` for the same-origin blob worker,
 * `${cspSource}` in `script-src` so that worker can `importScripts` the bundled worker resource,
 * and `data:` fonts for the inlined codicon .ttf. See `MonacoEditor.ensureMonacoEnvironment`.
 */
export interface RenderVqlHtmlOptions {
	webview: vscode.Webview;
	extensionUri: vscode.Uri;
	surface: ShellSurface;
	panelTab?: PopOutTab;
}

export function renderVqlHtml({
	webview,
	extensionUri,
	surface,
	panelTab,
}: RenderVqlHtmlOptions): string {
	const asset = (file: string): string =>
		webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', file)).toString();
	return buildVqlHtml({
		scriptUri: asset('main.js'),
		styleUri: asset('main.css'),
		workerUri: asset('editor.worker.js'),
		jsonWorkerUri: asset('json.worker.js'),
		cspSource: webview.cspSource,
		nonce: makeNonce(),
		surface,
		panelTab,
	});
}

/** Local-resource roots both surfaces must allow so the webview can load the bundle. */
export function vqlLocalResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
	return [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')];
}

/**
 * Construct the `VqlBus`, posting replies through the supplied `post` (the shell router's
 * `vql`-channel poster, which envelopes each message for the multiplexed webview transport). Exports
 * CSV via a save dialog and reads the export row cap from config live.
 */
export function createVqlBus(
	post: (message: HostToWebviewMessage) => void,
	deps: VqlHostDeps,
): VqlBus {
	return new VqlBus({
		connection: deps.connection,
		post,
		exportSink: (csv, suggestedName, meta) => saveCsv(csv, suggestedName, meta),
		confirmLargeExport: (total, apiCalls) => confirmLargeExport(total, apiCalls),
		history: deps.history,
		metadata: deps.metadata,
		savedQueries: deps.savedQueries,
		stateStore: deps.stateStore,
		promptSaveName: async () => {
			const name = await vscode.window.showInputBox({
				title: 'Save VQL Query',
				prompt: 'Name this query',
				placeHolder: 'e.g. active documents',
				validateInput: (input) => {
					if (input.trim().length === 0) {
						return { message: 'Enter a name.', severity: vscode.InputBoxValidationSeverity.Error };
					}
					if (savedQueryExists(deps.savedQueries.list(), input)) {
						return {
							message: `Overwrites the existing saved query "${input.trim()}".`,
							severity: vscode.InputBoxValidationSeverity.Info,
						};
					}
					return undefined;
				},
			});
			return name?.trim() || undefined;
		},
		clipboard: () => Promise.resolve(vscode.env.clipboard.readText()),
	});
}

/**
 * Show a confirmation modal for large exports (≥10k rows). Returns true if the user clicks Continue,
 * false if they cancel or dismiss the modal.
 */
async function confirmLargeExport(total: number, apiCalls: number): Promise<boolean> {
	const detail = `You are about to download ${total.toLocaleString()} results, which will generate ${apiCalls.toLocaleString()} Vault API calls. Large exports may impact end-user experience. Do you want to continue?`;
	const continueButton = 'Continue';
	const choice = await vscode.window.showWarningMessage(
		'Large export',
		{ modal: true, detail },
		continueButton,
	);
	return choice === continueButton;
}

/**
 * Prompt for a save location — defaulting to the user's Downloads folder — and write the CSV there
 * under a progress notification. Resolves to the saved fs path, or `undefined` if the user cancels.
 *
 * On success it surfaces a confirmation toast (row count) with Open File and Reveal
 * actions. The toast is fired without awaiting so the caller can post its result and clear the
 * webview's spinner immediately, rather than blocking until the user dismisses the toast.
 */
async function saveCsv(csv: string, suggestedName: string, meta: ExportMeta): Promise<string | undefined> {
	const downloadsDir = vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), 'Downloads');
	const target = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.joinPath(downloadsDir, suggestedName),
		filters: { 'CSV files': ['csv'] },
		saveLabel: 'Export',
	});
	if (!target) {
		return undefined;
	}
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Exporting VQL results…' },
		() => vscode.workspace.fs.writeFile(target, new TextEncoder().encode(csv)),
	);
	notifyExportComplete(target, meta);
	return target.fsPath;
}

/** Show the post-export confirmation toast with Open File / Reveal actions (not awaited). */
function notifyExportComplete(target: vscode.Uri, meta: ExportMeta): void {
	const fileName = path.basename(target.fsPath);
	const message = `Exported ${meta.rowCount.toLocaleString()} row${meta.rowCount === 1 ? '' : 's'} to ${fileName}.`;
	const openFile = 'Open File';
	const reveal = revealInOsLabel();
	void vscode.window.showInformationMessage(message, openFile, reveal).then((choice) => {
		if (choice === openFile) {
			return vscode.commands.executeCommand('vscode.open', target);
		}
		if (choice === reveal) {
			return revealInOs(target);
		}
		return undefined;
	});
}
