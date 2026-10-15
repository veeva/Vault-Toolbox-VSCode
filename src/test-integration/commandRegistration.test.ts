import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { activateExtension } from './testHelpers';

/**
 * Every `vaultToolbox.*` command the manifest contributes must actually be registered by `activate()`.
 * This catches the class of bug where a command is declared in `package.json` (so it shows in the
 * palette / a menu) but never `registerCommand`'d — invoking it then throws "command not found".
 * The expected ids are read from the extension's own `package.json`, so the list can't drift.
 */
suite('Command registration', () => {
	test('activate() registers every contributed vaultToolbox.* command', async () => {
		const extension = await activateExtension();

		const contributed: Array<{ command: string }> =
			(extension.packageJSON as { contributes?: { commands?: Array<{ command: string }> } })
				.contributes?.commands ?? [];
		const contributedIds = contributed
			.map((entry) => entry.command)
			.filter((id) => id.startsWith('vaultToolbox.'));
		assert.ok(contributedIds.length > 0, 'expected contributed commands in package.json');

		const registered = new Set(await vscode.commands.getCommands(true));
		const missing = contributedIds.filter((id) => !registered.has(id));
		assert.deepStrictEqual(missing, [], `these contributed commands are not registered: ${missing.join(', ')}`);
	});
});
