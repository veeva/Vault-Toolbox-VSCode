import * as vscode from 'vscode';
import { isSdkDeployCall, summarizeSdkDeploy } from '../../core/sdk/sdkDeploy';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import { guardProductionVault } from '../platform/guards';
import type { RunnableConnection } from '../connection/types';
import { runAndReportApiCall, type ApiCallReportDeps } from '../apiHistory/apiCallReport';
import { saveThenReadFileBytes } from './sdkFile';

/** Every Vault API call "Deploy to Vault" (Java SDK) makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-sdk';

/** What "Deploy to Vault" needs from the host: a connection, plus the API History deep-link seam. */
export interface DeploySdkCodeDeps extends ApiCallReportDeps {
	connection: RunnableConnection;
}

/**
 * The "Deploy to Vault" command for a `.java` file (**Deploy Java SDK Code**). A thin adapter: resolve
 * the target file, guard connection + Production, save-then-read its on-disk bytes, upload them via
 * `addOrReplaceSourceCode` through the active connection, and show the outcome in a non-modal
 * notification with a **View API Call** deep-link. There is no client-side `com.veeva.vault.custom`
 * check — a non-custom or otherwise invalid file simply receives Vault's own error, surfaced verbatim.
 * All decision-worthy logic lives in the tested core pieces (`VaultClient.addOrReplaceSourceCode`,
 * `summarizeSdkDeploy`); this owns only the vscode wiring.
 *
 * `resource` is the URI both context menus pass; it falls back to the active editor's document so the
 * command still works if invoked without one.
 */
export async function deploySdkCodeToVault(
	deps: DeploySdkCodeDeps,
	resource: vscode.Uri | undefined,
): Promise<void> {
	const { connection } = deps;
	const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
	if (!uri) {
		// Fire-and-forget: the decline is complete once we return, so don't await the toast. A
		// buttonless notification's thenable resolves only when a human dismisses it — awaiting it would
		// hang any unattended caller (e.g. the integration test host).
		void vscode.window.showErrorMessage('Open or select a .java file to deploy.');
		return;
	}

	const state = connection.getState();
	if (state.status !== 'connected' || !state.info) {
		// Defensive: the menu is greyed via `vaultToolbox.activeConnected` when not connected.
		void vscode.window.showErrorMessage('Connect to a Vault before deploying SDK code.');
		return;
	}
	const { info } = state;
	if (
		await guardProductionVault(
			info.domain?.domainType,
			info.environment.vaultDNS,
			'Deploy to Vault',
			'Vault Java SDK code cannot be deployed directly to a Production Vault. The ' +
				'change-controlled path to Production is a VPK deploy — this action targets sandboxes only.',
		)
	) {
		return;
	}

	// Save a dirty buffer first so the editor and Explorer entry points deploy the same on-disk bytes.
	const { fileName, bytes } = await saveThenReadFileBytes(uri);
	if (new TextDecoder().decode(bytes).trim().length === 0) {
		void vscode.window.showErrorMessage(
			'This .java file is empty or contains only whitespace; there is nothing to deploy.',
		);
		return;
	}

	const vaultDNS = info.environment.vaultDNS;
	await runAndReportApiCall(deps, {
		progressTitle: `Deploying ${fileName} to ${vaultDNS}…`,
		failurePrefix: 'Deploy to Vault failed:',
		isCall: isSdkDeployCall,
		summarize: summarizeSdkDeploy,
		execute: () =>
			connection.run((client) =>
				client.sdk.addOrReplaceSourceCode(fileName, bytes, REFERENCE_ID),
			),
	});
}
