import * as vscode from 'vscode';

/**
 * Save the open document for `uri` if it has unsaved edits, then read the file's on-disk bytes and its
 * basename. "Deploy to Vault" uploads exactly these saved-then-read bytes so the editor and Explorer
 * entry points deploy identical content, and Vault records the basename as the multipart filename.
 */
export async function saveThenReadFileBytes(
	uri: vscode.Uri,
): Promise<{ fileName: string; bytes: Uint8Array }> {
	const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
	if (doc?.isDirty) {
		await doc.save();
	}
	const bytes = await vscode.workspace.fs.readFile(uri);
	return { fileName: baseName(uri), bytes };
}

/**
 * Read a file's current text and its basename *without* saving. If the document is open, its live
 * in-editor text is used (dirty or not) so the class name is derived from what the developer sees;
 * otherwise the on-disk bytes are read. "Delete from Vault" only needs the `package` line and the
 * filename to build the class name — neither changes from an unsaved edit — so, unlike deploy, it must
 * not persist the buffer as a side-effect of a delete.
 */
export async function readFileText(uri: vscode.Uri): Promise<{ fileName: string; text: string }> {
	const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
	if (doc) {
		return { fileName: baseName(uri), text: doc.getText() };
	}
	const bytes = await vscode.workspace.fs.readFile(uri);
	return { fileName: baseName(uri), text: new TextDecoder().decode(bytes) };
}

/** The final path segment of a URI (its filename), using the URI's forward-slashed `path`. */
export function baseName(uri: vscode.Uri): string {
	const path = uri.path;
	const slash = path.lastIndexOf('/');
	return slash >= 0 ? path.slice(slash + 1) : path;
}
