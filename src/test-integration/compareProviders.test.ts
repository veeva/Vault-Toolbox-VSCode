import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { activateExtension } from './testHelpers';

/**
 * The Compare feature registers a `vault-compare` text-document content provider (backing the diff
 * editor) and the `vaultToolbox.compare` tree view. Both are `vscode`-API surfaces Vitest cannot
 * reach. Here we assert the externally-observable contract: a `vault-compare` URI resolves through a
 * registered provider (opening it succeeds instead of throwing "no provider"), and its virtual doc is
 * MDL-highlighted. The document is empty without an active comparison session — a live diff with
 * content is exercised end-to-end by the E2E Compare journey (ticket 12), not here.
 */
suite('Compare providers', () => {
	test('the vault-compare scheme resolves through a registered content provider', async () => {
		await activateExtension();

		const uri = vscode.Uri.from({
			scheme: 'vault-compare',
			path: '/Picklist/color__c @ example.veevavault.com.mdl',
			query: new URLSearchParams({ type: 'Picklist', name: 'color__c', side: 'source' }).toString(),
		});

		// Throws "no provider registered for vault-compare" if the content provider isn't wired.
		const document = await vscode.workspace.openTextDocument(uri);
		assert.strictEqual(document.uri.scheme, 'vault-compare');
		// The `.mdl` suffix drives the MDL grammar so both diff sides highlight.
		assert.strictEqual(document.languageId, 'mdl');
	});

	test('a code entry .java virtual document resolves and is Java-highlighted', async () => {
		await activateExtension();

		// A code entry's identity is its fully-qualified class name; `type` is empty and the path ends in
		// `.java` so VSCode's built-in Java grammar highlights both diff sides.
		const uri = vscode.Uri.from({
			scheme: 'vault-compare',
			path: '/com.veeva.vault.custom.triggers.Foo @ example.veevavault.com.java',
			query: new URLSearchParams({
				type: '',
				name: 'com.veeva.vault.custom.triggers.Foo',
				side: 'source',
			}).toString(),
		});

		const document = await vscode.workspace.openTextDocument(uri);
		assert.strictEqual(document.uri.scheme, 'vault-compare');
		assert.strictEqual(document.languageId, 'java');
	});
});
