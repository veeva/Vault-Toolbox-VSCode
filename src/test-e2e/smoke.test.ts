import * as assert from 'node:assert';
import { VSBrowser } from 'vscode-extension-tester';
import { VqlEditorView } from './pageObjects/vqlEditorView';

/**
 * Ticket 08 acceptance: prove the E2E harness can drive the extension and switch into the popped-out
 * VQL webview frame — the frame boundary that makes the journeys (10–12) flaky if handled ad hoc. It
 * goes through {@link VqlEditorView} rather than re-bracketing frames inline, so the one place that
 * owns `switchToFrame`/`switchBack` is also the one exercised here.
 *
 * Backend-agnostic: `test:e2e` sets a cassette for the whole suite (so Journey 1 can replay), but this
 * test asserts only that the tab opens and Monaco mounts inside the frame — never anything that depends
 * on a connection. The full connect → query → paginate flow is Journey 1 (ticket 10).
 *
 * CAVEAT: `npm run test:e2e` downloads VS Code + ChromeDriver on first run and cannot run while
 * another VS Code window is open (the Electron/ChromeDriver runner can't attach).
 */
describe('VQL editor webview smoke', function () {
	this.timeout(120000);

	before(async () => {
		await VSBrowser.instance.waitForWorkbench();
	});

	it('opens the popped-out editor tab and switches into its webview frame', async () => {
		// `open()` throws if the "VQL Editor" tab never appears, so reaching here already proves the
		// pop-out command wired up; `isEditorMounted` then proves the frame switch reaches Monaco.
		const editor = await VqlEditorView.open();
		assert.ok(await editor.isEditorMounted(), 'Monaco editor should mount inside the webview frame');
	});
});
