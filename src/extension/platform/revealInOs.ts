import * as vscode from 'vscode';

/** VS Code's convention for the "show this in the OS file manager" action label, per platform. */
export function revealInOsLabel(): string {
	if (process.platform === 'darwin') {
		return 'Reveal in Finder';
	}
	if (process.platform === 'win32') {
		return 'Reveal in Explorer';
	}
	return 'Open Containing Folder';
}

/** Reveal a file or folder in the OS file manager (Finder / Explorer / default). */
export function revealInOs(target: vscode.Uri): Thenable<unknown> {
	return vscode.commands.executeCommand('revealFileInOS', target);
}
