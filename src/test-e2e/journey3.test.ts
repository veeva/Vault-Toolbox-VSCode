import * as assert from 'node:assert';
import { EditorView, VSBrowser } from 'vscode-extension-tester';
import { CompareTab } from './pageObjects/compareTab';
import { CompareView } from './pageObjects/compareView';
import { disconnectEnv } from './pageObjects/harness';

/**
 * E2E Journey 3 (ticket 12) — Compare Environments, the highest-complexity journey: it spans the
 * Actions-tab webview (source/target selection) → the native `vaultToolbox.compare` tree (badged
 * entries) → the `vscode.diff` document (`vault-compare` scheme).
 *
 * Determinism comes from the committed `cassettes/journey3.json` (two Vaults' handshakes + component
 * queries). `maybeSeedE2eEnvironment` seeds the two Session-ID environments the cassette was scrubbed
 * to — `compare-source.veevavault.com` / `compare-target.veevavault.com`; the live recording used
 * Basic auth, but those `/auth` POSTs were dropped when scrubbing, so replay (Session-ID) issues none.
 * `CompareController` connects both on demand without stealing the active slot, so with only Journey
 * 1's env still connected this stays within MAX_CONNECTED (3) — Journey 2 disconnects its env first.
 *
 * The component-query pages were deliberately trimmed from the full ~1700-per-Vault dump down to the
 * three asserted entries below plus one identical component per remaining type (identical entries are
 * hidden by default, so they never render). This keeps the native tree at three visible rows: without
 * it, `requireItem` had to wheel-scroll a ~475-row virtualized list for each lookup, which alone made
 * this journey run ~60s. If you re-record, re-trim — don't commit the raw dump back.
 *
 * The asserted component names are drawn from the recorded component sets: `test_document_agent__c`
 * (source only), `fattest_cat__c` (target only), `base_object_chat_agent__sys` (modified) — each a
 * name unique among the tree's visible (non-identical) entries, so `requireItem` is unambiguous.
 * (`demo_custom_pages__c`, an earlier choice for target-only, doesn't work: its recorded
 * `mdl_definition__v` is Vault's `N/A` sentinel for code-type components with no MDL body, which
 * `VaultClient.fetchComponentDefinitions` skips outright — so it never reaches the tree at all.)
 *
 * CAVEAT (shared with the smoke suite): `npm run test:e2e` launches real VS Code headed on macOS and
 * cannot run while another VS Code window is open.
 */
describe('Compare Environments journey: select → tree → diff', function () {
	this.timeout(120000);

	const SOURCE_LABEL = 'E2E Compare Source';
	const TARGET_LABEL = 'E2E Compare Target';
	const SOURCE_ONLY = 'test_document_agent__c';
	const TARGET_ONLY = 'fattest_cat__c';
	const MODIFIED = 'base_object_chat_agent__sys';

	let tree: CompareView;

	before(async () => {
		await VSBrowser.instance.waitForWorkbench();
		const screen = await CompareTab.open();
		await screen.chooseSource(SOURCE_LABEL);
		await screen.chooseTarget(TARGET_LABEL);
		// This journey exercises only the MDL comparison; its cassette records no code fetch, so leave
		// Components (MDL) on and untick Code (Vault Java SDK).
		await screen.deselectCode();
		await screen.compare();
		tree = await CompareView.waitPopulated();
	});

	after(async () => {
		// Compare connects source and target on demand and never releases them; free both so a later
		// journey (e.g. the SDK-code compare) doesn't blow past the connected cap (MAX_CONNECTED = 3).
		await disconnectEnv(SOURCE_LABEL);
		await disconnectEnv(TARGET_LABEL);
	});

	it('badges entries by their source/target standing', async () => {
		assert.strictEqual(await tree.badgeOf(SOURCE_ONLY), 'Source Only');
		assert.strictEqual(await tree.badgeOf(TARGET_ONLY), 'Target Only');
		assert.strictEqual(await tree.badgeOf(MODIFIED), 'Modified');
	});

	it('opens a native diff for a selected entry', async () => {
		await tree.openDiff(SOURCE_ONLY);
		await VSBrowser.instance.driver.wait(
			async () =>
				(await new EditorView().getOpenEditorTitles()).some(
					(title) => title.includes(SOURCE_ONLY) && title.includes('↔'),
				),
			15000,
			`no diff editor titled for "${SOURCE_ONLY}" opened`,
		);
	});
});
