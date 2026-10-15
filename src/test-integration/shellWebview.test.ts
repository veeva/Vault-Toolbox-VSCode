import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { activateExtension } from './testHelpers';

/**
 * The unified sidebar is a `WebviewViewProvider` (`vaultToolbox.shell`). Focusing it via its
 * generated `.focus` command forces VS Code to call `resolveWebviewView`, which mounts the webview
 * and wires `onDidReceiveMessage`. We assert that path runs without throwing — the message
 * round-trip's *content* (host reacting to a webview post) is covered by the jsdom bus tests
 * (`vscodeApi.browser.test.tsx`) and the E2E journeys; the host API cannot read webview DOM state.
 */
suite('Shell webview view', () => {
	test('the shell view provider mounts when focused', async () => {
		await activateExtension();

		// The generated focus command exists only if the webview view is contributed and registered.
		const commands = new Set(await vscode.commands.getCommands(true));
		assert.ok(
			commands.has('vaultToolbox.shell.focus'),
			'expected the shell webview view to contribute a .focus command',
		);

		// Focusing forces resolveWebviewView (mount + message wiring). It must not throw.
		await vscode.commands.executeCommand('vaultToolbox.shell.focus');

		// `revealTab`-style navigation posts a message host → webview through the mounted view.
		await vscode.commands.executeCommand('vaultToolbox.showVqlSidebar');
	});
});
