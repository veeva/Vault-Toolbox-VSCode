import * as vscode from 'vscode';
import { buildMdlDropStatement } from '../../core/mdl/mdlDrop';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import type { RunnableConnection } from '../connection/types';
import { guardProductionVault } from '../platform/guards';
import { saveThenReadFileText } from './mdlFile';
import { runAndReportMdlExecute, type OutcomeToastDeps } from '../platform/outcomeToast';

/** What "Drop from Vault" needs from the host: a connection, plus the API History deep-link seam. */
export interface DropMdlDeps extends OutcomeToastDeps {
	connection: RunnableConnection;
}

/** The confirmation button label; matched to distinguish "Drop" from a dismissed modal. */
const DROP_CONFIRM = 'Drop';

/** Every Vault API call "Drop from Vault" makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-mdl';

/**
 * The "Drop from Vault" command (MDL Execute; see ADR 0005). Sibling of "Deploy to Vault": instead of
 * sending the file's definition it derives a single `DROP <ComponentType> <ComponentName>;` from the
 * file's leading header and executes that. Because a drop deletes the component, it guards Production
 * and requires an explicit modal confirmation showing the exact statement before running. Outcome
 * reporting and the **View API Call** deep-link are shared with deploy via `runAndReportMdlExecute`;
 * the statement construction lives in the tested core piece (`buildMdlDropStatement`).
 */
export async function dropMdlFromVault(
	deps: DropMdlDeps,
	resource: vscode.Uri | undefined,
): Promise<void> {
	const { connection } = deps;
	const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
	if (!uri) {
		// Fire-and-forget: the decline is complete once we return, so don't await the toast. A
		// buttonless notification's thenable resolves only when a human dismisses it — awaiting it
		// would hang any unattended caller (e.g. the integration test host).
		void vscode.window.showErrorMessage('Open or select an .mdl file to drop.');
		return;
	}

	const state = connection.getState();
	if (state.status !== 'connected' || !state.info) {
		// Defensive: the menu is greyed via `vaultToolbox.activeConnected` when not connected.
		void vscode.window.showErrorMessage('Connect to a Vault before dropping MDL.');
		return;
	}
	const { info } = state;
	if (
		await guardProductionVault(
			info.domain?.domainType,
			info.environment.vaultDNS,
			'Drop from Vault',
			'MDL cannot be dropped directly on a Production Vault. This action targets sandboxes only.',
		)
	) {
		return;
	}

	// Save a dirty buffer first so the editor and Explorer entry points drop the same on-disk text.
	const body = await saveThenReadFileText(uri);
	const parsed = buildMdlDropStatement(body);
	if (!parsed.ok) {
		void vscode.window.showErrorMessage(parsed.error);
		return;
	}

	const vaultDNS = info.environment.vaultDNS;
	if (!(await confirmDrop(parsed.target.statement, vaultDNS))) {
		return;
	}

	await runAndReportMdlExecute(deps, {
		progressTitle: `Dropping MDL from ${vaultDNS}…`,
		failurePrefix: 'Drop from Vault failed:',
		execute: () =>
			connection.run((client) => client.mdl.executeMdl(parsed.target.statement, REFERENCE_ID)),
	});
}

/** Confirm the destructive drop in a modal showing the exact statement and target Vault. */
async function confirmDrop(statement: string, vaultDNS: string): Promise<boolean> {
	const choice = await vscode.window.showWarningMessage(
		`Drop this component from ${vaultDNS}? This permanently deletes it.`,
		{ modal: true, detail: statement },
		DROP_CONFIRM,
	);
	return choice === DROP_CONFIRM;
}
