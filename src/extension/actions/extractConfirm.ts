import * as vscode from 'vscode';
import type { RunnableConnection } from '../connection/types';
import { scanExistingFiles, waitForSettingsTabClosed } from './extractMirror';
import { getVaultToolboxSetting } from '../platform/vscodeSettings';

/**
 * Parameterisation for the confirm/Change-Location modal loop shared by the "extract to a
 * faithful mirror folder" actions (Extract MDL, Extract Java SDK Code).
 */
export interface ExtractConfirmOptions {
	/** VS Code setting key for the target directory, e.g. `'MDLDirectory'`. */
	settingKey: string;
	/** Fallback directory when the setting is unset, e.g. `'vault-toolbox/mdl'`. */
	defaultDirectory: string;
	/** Extension scanned for the "may be deleted" warning, e.g. `'.mdl'` or `'.java'`. */
	extension: string;
	/** Label used in the deletion warning: `'MDL files'` or `'.java files'`. */
	fileLabel: string;
	/** Modal confirm question shown to the user. */
	confirmQuestion: string;
	/** Error message when the connection is not in the connected state. */
	notConnectedMessage: string;
	/** Error message when no workspace folder is open. */
	noWorkspaceFolderMessage: string;
}

/**
 * Guard preconditions (connected, vaultId, open workspace) then run the confirm/Change-Location
 * modal loop shared by Extract MDL and Extract Java SDK Code.
 *
 * Returns the resolved `extractRoot` URI on confirmation, or `null` if a precondition failed or
 * the user cancelled/dismissed the modal. Callers should `return` immediately on `null`.
 *
 * The "cannot determine Vault ID" error message is constant across all extract actions and is not
 * parameterised here.
 */
export async function resolveExtractRoot(
	connection: RunnableConnection,
	opts: ExtractConfirmOptions,
): Promise<vscode.Uri | null> {
	const state = connection.getState();
	if (state.status !== 'connected' || !state.info) {
		void vscode.window.showErrorMessage(opts.notConnectedMessage);
		return null;
	}
	const { info } = state;
	if (info.vaultId === undefined) {
		void vscode.window.showErrorMessage('Cannot determine the connected Vault ID; reconnect and retry.');
		return null;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage(opts.noWorkspaceFolderMessage);
		return null;
	}

	for (;;) {
		// See getVaultToolboxSetting for why setting keys use PascalCase, not camelCase.
		const directory = getVaultToolboxSetting(opts.settingKey, opts.defaultDirectory);
		const extractRoot = vscode.Uri.joinPath(workspaceFolder.uri, directory, String(info.vaultId));

		const destination = [directory, info.vaultId].join('/');
		const hasExistingFiles = (await scanExistingFiles(extractRoot, opts.extension)).length > 0;
		const detail = hasExistingFiles
			? `Files will be written to ${destination} \n\n Any local ${opts.fileLabel} that are not in Vault will be deleted.`
			: `Files will be written to ${destination}`;

		const confirmed = await vscode.window.showWarningMessage(
			opts.confirmQuestion,
			{ modal: true, detail },
			'Extract',
			'Change Location',
		);
		if (confirmed === 'Change Location') {
			await vscode.commands.executeCommand('workbench.action.openSettings', `vaultToolbox.${opts.settingKey}`);
			await waitForSettingsTabClosed();
			continue;
		}
		if (confirmed !== 'Extract') {
			return null;
		}
		return extractRoot;
	}
}
