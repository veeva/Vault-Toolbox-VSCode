import * as assert from 'node:assert';
import * as vscode from 'vscode';

/** The extension's fully-qualified id (`publisher.name` from package.json). */
export const EXTENSION_ID = 'veeva.vault-toolbox-vscode';

/**
 * Resolve the extension in the test host and ensure it's activated. Every integration suite needs
 * a live, activated extension before asserting anything, so this single helper replaces the
 * repeated `getExtension(...)!.activate()` boilerplate and keeps the id in one place.
 */
export async function activateExtension(): Promise<vscode.Extension<unknown>> {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	assert.ok(extension, `expected the Vault Toolbox extension (${EXTENSION_ID}) in the test host`);
	await extension.activate();
	return extension;
}
