import * as vscode from 'vscode';

/**
 * Shared vscode/fs utilities for the "extract to a faithful mirror folder" actions (Extract MDL, Extract
 * Java SDK Code). These carry no domain narrative — they are the generic settings-reprompt and
 * orphan-scan/delete plumbing both actions need — so they live here rather than being duplicated per
 * action. The per-action orchestration (which query, which file layout, how orphans are computed) stays
 * in each action file.
 */

/**
 * Resolves once the Settings editor tab is closed, so an action's confirm dialog reappears only after the
 * user is done adjusting the directory setting via **Change Location**.
 */
export function waitForSettingsTabClosed(): Promise<void> {
	return new Promise((resolve) => {
		const isSettingsTab = (tab: vscode.Tab) => tab.label === 'Settings';
		const isSettingsTabOpen = () => vscode.window.tabGroups.all.some((group) => group.tabs.some(isSettingsTab));
		if (!isSettingsTabOpen()) {
			resolve();
			return;
		}
		const subscription = vscode.window.tabGroups.onDidChangeTabs(() => {
			if (!isSettingsTabOpen()) {
				subscription.dispose();
				resolve();
			}
		});
	});
}

/**
 * Recursively collect existing files under `root` with the given extension (e.g. `.mdl`, `.java`) as
 * forward-slashed paths relative to `root`. A missing/unreadable `root` (first extraction) yields `[]`.
 */
export async function scanExistingFiles(root: vscode.Uri, extension: string): Promise<string[]> {
	return findFilesUnder(root, '', extension);
}

async function findFilesUnder(dir: vscode.Uri, prefix: string, extension: string): Promise<string[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return []; // directory doesn't exist yet (first extraction) or isn't readable
	}
	const paths: string[] = [];
	for (const [name, type] of entries) {
		const relativePath = prefix ? `${prefix}/${name}` : name;
		if (type === vscode.FileType.Directory) {
			paths.push(...(await findFilesUnder(vscode.Uri.joinPath(dir, name), relativePath, extension)));
		} else if (type === vscode.FileType.File && name.endsWith(extension)) {
			paths.push(relativePath);
		}
	}
	return paths;
}

/** Delete each orphaned `root`-relative (forward-slashed) path. */
export async function deleteOrphans(root: vscode.Uri, orphans: string[]): Promise<void> {
	for (const relativePath of orphans) {
		await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, ...relativePath.split('/')));
	}
}
