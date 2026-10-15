import * as assert from 'node:assert';
import * as path from 'node:path';
import { TextEditor, VSBrowser } from 'vscode-extension-tester';
import { pickQuickPick, runPaletteCommand, waitForNotification } from './pageObjects/harness';

/**
 * E2E Journey 2 (ticket 11) — the MDL "Deploy to Vault" command, a journey that leans on VS Code
 * (environment quick pick, editor context menu, outcome notification) more than webview DOM.
 *
 * Determinism comes from the committed `cassettes/journey2.json`: `test:e2e` points
 * `VAULT_TOOLBOX_E2E_CASSETTE` at the cassettes directory, so `createBaseTransport` replays instead of
 * hitting the network, and `maybeSeedE2eEnvironment` seeds the matching `mdl-sandbox.vaultdev.com`
 * environment (Session-ID auth, so no `/auth` POST — the cassette records none). `.vaultdev.com` keeps
 * the Production guard off, so the deploy is not blocked.
 *
 * The `.mdl` fixture must be byte-identical to the recorded MDL Execute request body, because
 * `ReplayHttpTransport` matches POSTs on method + url + body; `fixtures/brand__c.mdl` was generated
 * from the cassette to guarantee that. Deploying an unmodified, already-saved file reads that exact
 * text back (`saveThenReadFileText` only saves a dirty buffer), so the request matches.
 *
 * CAVEAT (shared with the smoke suite): `npm run test:e2e` launches real VS Code headed on macOS and
 * cannot run while another VS Code window is open.
 */
describe('MDL deploy journey: connect → deploy → outcome toast', function () {
	this.timeout(120000);

	// The seeded label, used to pick the env from "Connect"'s unfiltered list before it's connected.
	const SEEDED_LABEL = 'E2E MDL Sandbox';
	// `EnvironmentService.connect` adopts the Vault's own reported name as the label once connected
	// (see its docstring) — the cassette's `domain` response names vault 259414 "MDL Sandbox", so by
	// the time "Disconnect" opens its quick pick, `SEEDED_LABEL` no longer matches any row. Both labels
	// still share "MDL Sandbox", which is enough for `pickQuickPick`'s fuzzy filter either way, but
	// naming this explicitly (rather than relying on the substring overlap) keeps the rename visible.
	const CONNECTED_LABEL = 'MDL Sandbox';
	const FIXTURE = path.resolve(process.cwd(), 'src/test-e2e/fixtures/brand__c.mdl');

	before(async () => {
		await VSBrowser.instance.waitForWorkbench();
		// Connect (and activate) the MDL env; "Deploy to Vault" acts on the active connection.
		await runPaletteCommand('Vault Toolbox: Connect');
		await pickQuickPick(SEEDED_LABEL);
		await waitForNotification(/Connected to/);
		await VSBrowser.instance.openResources(FIXTURE);
	});

	after(async () => {
		// Free the connection slot so Journey 3's two-Vault compare stays within MAX_CONNECTED (3).
		await runPaletteCommand('Vault Toolbox: Disconnect');
		await pickQuickPick(CONNECTED_LABEL);
	});

	it('deploys the .mdl and reports success', async () => {
		await deployActiveMdlFile();
		const toast = await waitForNotification(/Deploy to Vault succeeded/);
		assert.match(
			await toast.getMessage(),
			/Components affected: 1/,
			'success toast should report the single component the cassette recorded',
		);
	});

	it('records the deploy in API History (surfaced as the toast’s View API Call action)', async () => {
		// The "View API Call" action is added only when the reporter locates this deploy's entry in
		// the API History snapshot — so its presence proves the call was recorded.
		const toast = await waitForNotification(/Deploy to Vault succeeded/);
		const actionTitles = await Promise.all(
			(await toast.getActions()).map((action) => action.getTitle()),
		);
		assert.ok(
			actionTitles.includes('View API Call'),
			`expected a "View API Call" action; got ${JSON.stringify(actionTitles)}`,
		);
	});
});

/**
 * Invokes "Deploy to Vault" from the active `.mdl` editor's context menu. The command is contributed
 * only to the `.mdl` editor/explorer context submenu (`commandPalette: false`), so it can't be run
 * from the palette; the handler deploys the active editor's document when no explicit resource is passed.
 */
async function deployActiveMdlFile(): Promise<void> {
	const menu = await new TextEditor().openContextMenu();
	await menu.select('Vault Toolbox', 'Deploy to Vault');
}
