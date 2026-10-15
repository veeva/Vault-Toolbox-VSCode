import * as assert from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EditorView, VSBrowser } from 'vscode-extension-tester';
import { CompareTab } from './pageObjects/compareTab';
import { CompareView } from './pageObjects/compareView';
import { disconnectEnv } from './pageObjects/harness';

/**
 * E2E Journey 4 (Compare SDK code) — the code arm of Compare Environments, the one path Journey 3
 * deliberately skips (it unticks Code). With BOTH toggles on, the comparison fetches MDL and custom
 * Vault Java SDK code from both Vaults, and the `vaultToolbox.compare` tree grows the two-kind split:
 * a **Components (MDL)** wrapper node (type groups) and a separate **Code (Vault Java SDK)** wrapper
 * whose entries nest in a Java package tree — plus the code-only **Unavailable** status for a class
 * whose source GET fails. This journey asserts each code status badge, the two-node structure, and a
 * Java diff.
 *
 * Determinism comes from `cassettes/journey4.json`, seeded against `code-compare-source` /
 * `code-compare-target.veevavault.com` (`e2eSeed`, `hasCustomLabel` so their labels stay stable for
 * teardown). Journey 3 now releases its two on-demand connections in `after`, so this journey's two
 * connects stay within MAX_CONNECTED (3) alongside Journey 1's still-connected env.
 *
 * AUTHORING THE CASSETTE (why this suite self-skips until then): replay THROWS on any unmatched
 * request, so the cassette must contain the exact request set the code+MDL compare emits — the two
 * handshakes, each Vault's MDL Component Definition Query, each Vault's custom-code name query
 * (`SELECT component_name__v FROM vault_component__v WHERE component_name__v LIKE 'com.veeva.vault.custom%'`),
 * and one `GET /code/{class}` per class (binary Java, stored as readable UTF-8 via the cassette's
 * `__cassetteBinaryUtf8__` wrapper). Record the SOURCE side live against one sandbox
 * (`VAULT_TOOLBOX_E2E_RECORD`, or `scripts/pull-sdk-code.sh` for the raw bodies), then slim + scrub the
 * Java to generic, non-sensitive source and synthesize the TARGET side by cloning the source entries
 * onto the target host and injecting the curated diffs below. Names are Wire easter eggs, matching the
 * existing cassettes' flavour (see Journey 1's "Bunk Moreland" / "Stringer Bell").
 *
 * Curated code diffs the cassette must encode:
 *   - {@link SOURCE_ONLY}  present on source only            → "Source Only"
 *   - {@link TARGET_ONLY}  present on target only            → "Target Only"
 *   - {@link MODIFIED}     present both, source text differs → "Modified"
 *   - {@link UNAVAILABLE}  present, source GET returns a 200 FAILURE ("File not found.") → "Unavailable"
 * plus at least one MDL diff ({@link MDL_MODIFIED}) so the Components (MDL) node is non-empty and the
 * two-kind wrapper split renders.
 *
 * CAVEAT (shared with the smoke suite): `npm run test:e2e` launches real VS Code headed on macOS and
 * cannot run while another VS Code window is open.
 */
const CASSETTE_DIR = process.env.VAULT_TOOLBOX_E2E_CASSETTE;
const HAS_CASSETTE = !!CASSETTE_DIR && existsSync(join(CASSETTE_DIR, 'journey4.json'));

(HAS_CASSETTE ? describe : describe.skip)(
	'Compare SDK code journey: both kinds → package tree → java diff',
	function () {
		this.timeout(120000);

		const SOURCE_LABEL = 'E2E Code Source';
		const TARGET_LABEL = 'E2E Code Target';

		// Code entries render under the Code node by their simple class name; the diff tab leads with the
		// fully-qualified name. `requireItem`/`badgeOf` look up by the simple (row) name.
		const SOURCE_ONLY = 'BunkMorelandAction';
		const TARGET_ONLY = 'StringerBellService';
		const MODIFIED = 'McNultyCaseTrigger';
		const UNAVAILABLE = 'OmarComingJob';
		// One MDL diff, so the Components (MDL) wrapper node is present alongside the Code node.
		const MDL_MODIFIED = 'avon_barksdale__c';

		const MDL_NODE = 'Components (MDL)';
		const CODE_NODE = 'Code (Vault Java SDK)';

		let tree: CompareView;

		before(async () => {
			await VSBrowser.instance.waitForWorkbench();
			const screen = await CompareTab.open();
			await screen.chooseSource(SOURCE_LABEL);
			await screen.chooseTarget(TARGET_LABEL);
			// Force BOTH toggles on so the comparison fetches MDL and code and the tree shows the two-kind
			// split — Journey 3 unticks Code earlier in the session and that choice persists in the webview.
			await screen.selectBothKinds();
			await screen.compare();
			tree = await CompareView.waitPopulated();
		});

		after(async () => {
			await disconnectEnv(SOURCE_LABEL);
			await disconnectEnv(TARGET_LABEL);
		});

		it('splits the tree into Components (MDL) and Code (Vault Java SDK) wrapper nodes', async () => {
			const labels = await tree.visibleLabels();
			assert.ok(labels.includes(MDL_NODE), `expected an "${MDL_NODE}" node; got ${JSON.stringify(labels)}`);
			assert.ok(labels.includes(CODE_NODE), `expected a "${CODE_NODE}" node; got ${JSON.stringify(labels)}`);
		});

		it('badges code entries by their source/target standing, including Unavailable', async () => {
			assert.strictEqual(await tree.badgeOf(SOURCE_ONLY), 'Source Only');
			assert.strictEqual(await tree.badgeOf(TARGET_ONLY), 'Target Only');
			assert.strictEqual(await tree.badgeOf(MODIFIED), 'Modified');
			assert.strictEqual(await tree.badgeOf(UNAVAILABLE), 'Unavailable');
		});

		it('still compares MDL alongside code', async () => {
			assert.strictEqual(await tree.badgeOf(MDL_MODIFIED), 'Modified');
		});

		it('opens a native Java diff for a selected code entry', async () => {
			await tree.openDiff(MODIFIED);
			await VSBrowser.instance.driver.wait(
				async () =>
					(await new EditorView().getOpenEditorTitles()).some(
						(title) => title.includes(MODIFIED) && title.includes('↔'),
					),
				15000,
				`no diff editor titled for "${MODIFIED}" opened`,
			);
		});
	},
);
