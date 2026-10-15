import * as vscode from 'vscode';

/**
 * Save the open document for `uri` if it has unsaved edits, then read the file's on-disk text. Both
 * MDL context-menu commands — "Deploy to Vault" and "Drop from Vault" — act on the same
 * saved-then-read contents so the editor and Explorer entry points operate on identical text.
 */
export async function saveThenReadFileText(uri: vscode.Uri): Promise<string> {
	const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
	if (doc?.isDirty) {
		await doc.save();
	}
	const bytes = await vscode.workspace.fs.readFile(uri);
	return new TextDecoder().decode(bytes);
}
