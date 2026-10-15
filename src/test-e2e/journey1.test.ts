import * as assert from 'node:assert';
import { VSBrowser } from 'vscode-extension-tester';
import { VqlEditorView } from './pageObjects/vqlEditorView';

/**
 * E2E Journey 1 (ticket 10) — the flagship `vqlClient → vqlBus → ResultGrid` loop through the
 * popped-out VQL editor webview, against the replay backend.
 *
 * Determinism comes from the committed `cassettes/journey1.json`: `test:e2e` sets
 * `VAULT_TOOLBOX_E2E_CASSETTE` to it, so `createBaseTransport` replays instead of hitting the network,
 * and `maybeSeedE2eEnvironment` seeds+activates the matching `example.veevavault.com` environment that
 * the activation auto-reconnect then connects. No network, no live sandbox.
 *
 * The cassette's `documents` result is 9 rows at PAGESIZE 5: page 1 has 5 rows and only a next-page
 * token; page 2 has 4 rows and only a previous-page token — so the pager gates are asserted at both
 * ends (Prev disabled on page 1, Next disabled on the last page).
 *
 * CAVEAT (shared with the smoke suite): `npm run test:e2e` launches real VS Code headed on macOS and
 * cannot run while another VS Code window is open.
 */
describe('VQL editor journey: connect → run → paginate', function () {
	this.timeout(120000);

	const QUERY = 'SELECT id, name__v FROM documents PAGESIZE 5';
	// The full recorded `name__v` columns (cassettes/journey1.json). Page 1's fourth row is the
	// deliberately awkward `"Boat\n\nBears"` cell, normalized here since the DOM collapses its newlines.
	const PAGE_1_NAMES = ['Boat', 'Bike Two', 'Bike', 'Boat Bears', 'Placeholder'];
	const PAGE_2_NAMES = [
		'Doctype trigger test',
		'My Favorite Binder',
		'Bunk Moreland Case File',
		'Stringer Bell Business Plan',
	];

	let editor: VqlEditorView;

	before(async () => {
		await VSBrowser.instance.waitForWorkbench();
		editor = await VqlEditorView.open();
		await editor.setQuery(QUERY);
		await editor.waitUntilConnected();
		await editor.submitRun();
	});

	it('renders every row of the first page', async () => {
		await waitForRowCount(editor, 5);
		assert.deepStrictEqual(await normalizedNames(editor), PAGE_1_NAMES);
	});

	it('gates the pager at the first page (Prev disabled, Next enabled)', async () => {
		assert.strictEqual(await editor.isPrevEnabled(), false, 'Prev should be disabled on page 1');
		assert.strictEqual(await editor.isNextEnabled(), true, 'Next should be enabled on page 1');
	});

	it('follows Next to the last page and gates it (Next disabled, Prev enabled)', async () => {
		await editor.clickNext();
		await waitForRowCount(editor, 4);
		assert.deepStrictEqual(await normalizedNames(editor), PAGE_2_NAMES);
		assert.strictEqual(await editor.isNextEnabled(), false, 'Next should be disabled on the last page');
		assert.strictEqual(await editor.isPrevEnabled(), true, 'Prev should be enabled on the last page');
	});

	it('follows Prev back to the first page and re-gates it', async () => {
		await editor.clickPrev();
		await waitForRowCount(editor, 5);
		assert.deepStrictEqual(await normalizedNames(editor), PAGE_1_NAMES);
		assert.strictEqual(await editor.isPrevEnabled(), false, 'Prev should be disabled back on page 1');
		assert.strictEqual(await editor.isNextEnabled(), true, 'Next should be enabled back on page 1');
	});
});

/** The rendered `name__v` column with each cell's inner whitespace collapsed to single spaces, so a
 *  multi-line cell compares stably regardless of how the DOM renders its line breaks. */
async function normalizedNames(editor: VqlEditorView): Promise<string[]> {
	const names = await editor.getResultNames();
	return names.map((name) => name.replace(/\s+/g, ' ').trim());
}

/** Waits for the result grid to settle on `expected` body rows — a page follow is an async round-trip. */
async function waitForRowCount(editor: VqlEditorView, expected: number): Promise<void> {
	await VSBrowser.instance.driver.wait(
		async () => (await editor.getResultRowCount()) === expected,
		15000,
		`result grid never settled on ${expected} rows`,
	);
}
