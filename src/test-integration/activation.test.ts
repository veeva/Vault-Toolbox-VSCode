import * as assert from 'node:assert';
import { activateExtension } from './testHelpers';

/**
 * Placeholder smoke test that proves the harness boots: a real VS Code launches, the extension
 * activates, and Mocha runs a compiled suite. Ticket 07 adds the real command-wiring / context-key /
 * webview / tree assertions alongside this.
 */
suite('Extension host harness', () => {
	test('the extension is present and activates', async () => {
		const extension = await activateExtension();
		assert.strictEqual(extension.isActive, true);
	});
});
