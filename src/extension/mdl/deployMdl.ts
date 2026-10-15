import * as vscode from 'vscode';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import type { RunnableConnection } from '../connection/types';
import { guardProductionVault } from '../platform/guards';
import { saveThenReadFileText } from './mdlFile';
import { runAndReportMdlExecute, type OutcomeToastDeps } from '../platform/outcomeToast';

/** Every Vault API call "Deploy to Vault" makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-mdl';

/** What "Deploy to Vault" needs from the host: a connection, plus the API History deep-link seam. */
export interface DeployMdlDeps extends OutcomeToastDeps {
	connection: RunnableConnection;
}

/**
 * The "Deploy to Vault" command (MDL Execute; see ADR 0005). A thin adapter: resolve the target
 * `.mdl` file, guard connection + Production, save-then-read its on-disk contents, run
 * `executeMdl` through the active connection, and show the outcome in a non-modal notification. The
 * toast offers a **View API Call** button that jumps to this deploy's entry in the API History inspector —
 * where the full request and raw response envelope are readable. All the decision-worthy logic lives
 * in the tested core pieces (`VaultClient.executeMdl`, `summarizeMdlDeploy`) and the shared
 * `runAndReportMdlExecute` reporter; this owns only the vscode wiring.
 *
 * `resource` is the URI both context menus pass; it falls back to the active editor's document so
 * the command still works if invoked without one.
 */
export async function deployMdlToVault(
	deps: DeployMdlDeps,
	resource: vscode.Uri | undefined,
): Promise<void> {
	const { connection } = deps;
	const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
	if (!uri) {
		// Fire-and-forget: the decline is complete once we return, so don't await the toast. A
		// buttonless notification's thenable resolves only when a human dismisses it — awaiting it
		// would hang any unattended caller (e.g. the integration test host).
		void vscode.window.showErrorMessage('Open or select an .mdl file to deploy.');
		return;
	}

	const state = connection.getState();
	if (state.status !== 'connected' || !state.info) {
		// Defensive: the menu is greyed via `vaultToolbox.activeConnected` when not connected.
		void vscode.window.showErrorMessage('Connect to a Vault before deploying MDL.');
		return;
	}
	const { info } = state;
	if (
		await guardProductionVault(
			info.domain?.domainType,
			info.environment.vaultDNS,
			'Deploy to Vault',
			'MDL cannot be deployed directly to a Production Vault. The change-controlled path to ' +
				'Production is a VPK deploy — this action targets sandboxes only.',
		)
	) {
		return;
	}

	// Save a dirty buffer first so the editor and Explorer entry points deploy the same on-disk text.
	const script = await saveThenReadFileText(uri);
	if (script.trim().length === 0) {
		void vscode.window.showErrorMessage(
			'This .mdl file is empty or contains only whitespace; there is nothing to deploy.',
		);
		return;
	}

	const vaultDNS = info.environment.vaultDNS;
	await runAndReportMdlExecute(deps, {
		progressTitle: `Deploying MDL to ${vaultDNS}…`,
		failurePrefix: 'Deploy to Vault failed:',
		execute: () => connection.run((client) => client.mdl.executeMdl(script, REFERENCE_ID)),
	});
}
