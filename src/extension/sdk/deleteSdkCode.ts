import * as vscode from 'vscode';
import { deriveSdkClassName, isSdkDeleteCall, summarizeSdkDelete } from '../../core/sdk/sdkDelete';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import { guardProductionVault } from '../platform/guards';
import type { RunnableConnection } from '../connection/types';
import { runAndReportApiCall, type ApiCallReportDeps } from '../apiHistory/apiCallReport';
import { readFileText } from './sdkFile';

/** What "Delete from Vault" needs from the host: a connection, plus the API History deep-link seam. */
export interface DeleteSdkCodeDeps extends ApiCallReportDeps {
	connection: RunnableConnection;
}

/** The confirmation button label; matched to distinguish "Delete" from a dismissed modal. */
const DELETE_CONFIRM = 'Delete';

/** Every Vault API call "Delete from Vault" makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-sdk';

/**
 * The "Delete from Vault" command for a `.java` file (**Delete Java SDK Code**). A thin adapter: resolve
 * the target file, guard connection + Production, derive the fully-qualified class name *locally* from
 * the file's `package` declaration plus its filename, confirm the destructive delete in a modal naming
 * the exact class and the target Vault, and — only on confirm — remove that source file via
 * `deleteSourceCode` through the active connection, showing the outcome in a non-modal notification with
 * a **View API Call** deep-link. When the FQCN cannot be derived (empty/unreadable file, no `package`,
 * or an unparseable `package` line) it aborts with a specific message and sends nothing. All
 * decision-worthy logic lives in the tested core pieces (`deriveSdkClassName`,
 * `VaultClient.deleteSourceCode`, `summarizeSdkDelete`); this owns only the vscode wiring.
 *
 * `resource` is the URI both context menus pass; it falls back to the active editor's document so the
 * command still works if invoked without one.
 */
export async function deleteSdkCodeFromVault(
	deps: DeleteSdkCodeDeps,
	resource: vscode.Uri | undefined,
): Promise<void> {
	const { connection } = deps;
	const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
	if (!uri) {
		// Fire-and-forget: the decline is complete once we return, so don't await the toast. A
		// buttonless notification's thenable resolves only when a human dismisses it — awaiting it would
		// hang any unattended caller (e.g. the integration test host).
		void vscode.window.showErrorMessage('Open or select a .java file to delete.');
		return;
	}

	const state = connection.getState();
	if (state.status !== 'connected' || !state.info) {
		// Defensive: the menu is greyed via `vaultToolbox.activeConnected` when not connected.
		void vscode.window.showErrorMessage('Connect to a Vault before deleting SDK code.');
		return;
	}
	const { info } = state;
	if (
		await guardProductionVault(
			info.domain?.domainType,
			info.environment.vaultDNS,
			'Delete from Vault',
			'Vault Java SDK code cannot be deleted directly from a Production Vault. The ' +
				'change-controlled path to Production is a VPK deploy — this action targets sandboxes only.',
		)
	) {
		return;
	}

	// Read the file's current text without saving — delete only needs the `package` line and filename to
	// build the class name, so it must not persist the developer's unsaved edits as a delete side-effect.
	const { fileName, text } = await readFileText(uri);
	const parsed = deriveSdkClassName(text, fileName);
	if (!parsed.ok) {
		void vscode.window.showErrorMessage(parsed.error);
		return;
	}

	const vaultDNS = info.environment.vaultDNS;
	if (!(await confirmDelete(parsed.className, vaultDNS))) {
		return;
	}

	await runAndReportApiCall(deps, {
		progressTitle: `Deleting ${parsed.className} from ${vaultDNS}…`,
		failurePrefix: 'Delete from Vault failed:',
		isCall: isSdkDeleteCall,
		summarize: summarizeSdkDelete,
		execute: () =>
			connection.run((client) => client.sdk.deleteSourceCode(parsed.className, REFERENCE_ID)),
	});
}

/** Confirm the destructive delete in a modal showing the exact class name and target Vault. */
async function confirmDelete(className: string, vaultDNS: string): Promise<boolean> {
	const choice = await vscode.window.showWarningMessage(
		`Delete this Vault Java SDK class from ${vaultDNS}? This permanently removes it.`,
		{ modal: true, detail: className },
		DELETE_CONFIRM,
	);
	return choice === DELETE_CONFIRM;
}
