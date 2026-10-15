import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { activateExtension } from './testHelpers';

/**
 * `vaultToolbox.deployMdl` / `dropMdl` are gated by the `vaultToolbox.activeConnected` context key
 * (see their `enablement` in package.json). The test host starts with no connected Vault, so the key
 * is false. VS Code exposes no API to read a context-key value or a command's computed enablement,
 * so we assert the reachable contract: the enablement-gated commands are still *registered* (the
 * `when`/`enablement` clause hides them from the palette but never unregisters them), and invoking
 * `deployMdl` with no connection surfaces the "not connected" guard rather than throwing an
 * unhandled error. The full green-path deploy (key true) is the E2E MDL journey (ticket 11).
 */
suite('Context-key gated commands', () => {
	test('deployMdl and dropMdl are registered even while disconnected', async () => {
		await activateExtension();

		const commands = new Set(await vscode.commands.getCommands(true));
		assert.ok(commands.has('vaultToolbox.deployMdl'), 'deployMdl should be registered');
		assert.ok(commands.has('vaultToolbox.dropMdl'), 'dropMdl should be registered');
	});

	test('invoking deployMdl while disconnected is handled, not thrown', async () => {
		await activateExtension();

		const fixture = vscode.Uri.joinPath(
			vscode.workspace.workspaceFolders![0].uri,
			'sample.mdl',
		);
		// The not-connected guard declines with a fire-and-forget toast, so the call resolves promptly
		// rather than rejecting. Bound the wait: if the guard regresses to awaiting a buttonless toast
		// (which only a human dismisses), fail fast here instead of hanging to Mocha's 60s timeout.
		const SETTLE_BUDGET_MS = 5000;
		const invoked = vscode.commands.executeCommand('vaultToolbox.deployMdl', fixture);
		const timedOut = Symbol('timed-out');
		const outcome = await Promise.race([
			Promise.resolve(invoked).then(() => 'settled'),
			new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), SETTLE_BUDGET_MS)),
		]);
		assert.notStrictEqual(outcome, timedOut, 'deployMdl should settle promptly, not block on a toast');
	});
});
