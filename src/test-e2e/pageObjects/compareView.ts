import {
	ActivityBar,
	By,
	CustomTreeItem,
	CustomTreeSection,
	SideBarView,
	TreeItem,
	VSBrowser,
	Workbench,
} from 'vscode-extension-tester';

const VIEW_CONTAINER = 'Vault Toolbox';
const SECTION_TITLE = 'Vault Compare';
const POPULATE_TIMEOUT_MS = 30000;
// Every component from both Vaults can land in this tree (thousands of rows for a real Vault), so a
// linear scroll needs real headroom — comfortably more than the list's row count can ever require.
const SCROLL_MAX_PAGES = 200;

/**
 * Page object for the native **Vault Compare** tree (`vaultToolbox.compare`), which populates after a
 * comparison runs. Entry rows carry the component name as their label and the status badge ("Source
 * Only" / "Target Only" / "Modified" / "Identical") as their description; clicking a row runs
 * `compareOpenDiff`. Type groups render expanded, so any entry is reachable — but not necessarily via
 * `findItem` (see {@link requireItem}).
 */
export class CompareView {
	private constructor(private readonly section: CustomTreeSection) {}

	/** Opens the Vault Toolbox container and waits for the Compare tree to have entries. */
	static async waitPopulated(): Promise<CompareView> {
		const control = await new ActivityBar().getViewControl(VIEW_CONTAINER);
		if (!control) {
			throw new Error(`view container "${VIEW_CONTAINER}" not found`);
		}
		await control.openView();
		const section = await CompareView.waitForSection();
		await VSBrowser.instance.driver.wait(
			async () => (await section.getVisibleItems()).length > 0,
			POPULATE_TIMEOUT_MS,
			'the Vault Compare tree never populated',
		);
		return new CompareView(section);
	}

	/**
	 * Waits for the Compare section to appear. The `vaultToolbox.compare` view is gated behind the
	 * `vaultToolbox.compareActive` context key, which the controller only sets once the comparison
	 * session finishes building (both Vaults connected, components fetched). Until then `getSection`
	 * throws `NoSuchElementError`, so poll it rather than calling it once.
	 */
	private static async waitForSection(): Promise<CustomTreeSection> {
		let section: CustomTreeSection | undefined;
		try {
			await VSBrowser.instance.driver.wait(
				async () => {
					try {
						section = (await new SideBarView().getContent().getSection(
							SECTION_TITLE,
						)) as CustomTreeSection;
						return true;
					} catch {
						return false;
					}
				},
				POPULATE_TIMEOUT_MS,
				`section "${SECTION_TITLE}" never appeared`,
			);
		} catch (error) {
			throw new Error(
				`${(error as Error).message}. ${await CompareView.diagnoseMissingSection()}`,
			);
		}
		return section as CustomTreeSection;
	}

	/**
	 * The section only appears once the controller sets `vaultToolbox.compareActive`, which it does only
	 * after the comparison session builds. When it never appears, the useful signal is which sections DO
	 * exist and whether the comparison surfaced an error toast — surface both so the timeout is
	 * actionable rather than opaque.
	 */
	private static async diagnoseMissingSection(): Promise<string> {
		const sections = await new SideBarView()
			.getContent()
			.getSections()
			.then((all) => Promise.all(all.map((section) => section.getTitle())))
			.catch(() => ['<could not read sidebar sections>']);
		const notifications = await new Workbench()
			.getNotifications()
			.then((all) => Promise.all(all.map((note) => note.getMessage())))
			.catch(() => ['<could not read notifications>']);
		return (
			`Sidebar sections present: [${sections.join(', ')}]. ` +
			`Notifications: [${notifications.join(' | ')}]`
		);
	}

	/**
	 * The labels of the tree's currently rendered rows. Used to assert top-level structure — e.g. that a
	 * both-kinds comparison shows the "Components (MDL)" and "Code (Vault Java SDK)" wrapper nodes. Like
	 * `getVisibleItems`, this only sees what renders near the top (see {@link requireItem}), which is
	 * enough for the small trees these journeys build.
	 */
	async visibleLabels(): Promise<string[]> {
		return Promise.all((await this.section.getVisibleItems()).map((item) => item.getLabel()));
	}

	/** The status badge (row description) of the entry named `componentName`. */
	async badgeOf(componentName: string): Promise<string> {
		const item = await this.requireItem(componentName);
		return (await item.findElement(By.css('.label-description'))).getText();
	}

	/** Clicks the entry, running its `compareOpenDiff` command to open the source-vs-target diff. */
	async openDiff(componentName: string): Promise<void> {
		const item = await this.requireItem(componentName);
		await item.click();
	}

	/**
	 * Finds `componentName`'s row, paging down when it isn't in the first screenful.
	 * `CustomTreeSection.findItem`/`getVisibleItems` re-fetch the list and send `Key.HOME` on *every*
	 * call (see `GenericCustomTreeSection.getContainer`), so they only ever see whatever renders at
	 * the very top — fine for a short list, useless once the tree holds hundreds of rows (every
	 * differing component across both Vaults). So: try the built-in lookup first (cheap, and correct
	 * for anything already near the top); if that misses, grab the list element once and page through
	 * its *currently rendered* rows ourselves, without going back through the Home-resetting API.
	 */
	private async requireItem(componentName: string): Promise<TreeItem> {
		const found = await this.section.findItem(componentName);
		if (found) {
			return found;
		}
		const list = await this.section.findElement(By.className('monaco-list'));
		const driver = VSBrowser.instance.driver;
		let lastTopIndex: string | null = null;
		for (let page = 0; page < SCROLL_MAX_PAGES; page++) {
			const rows = await list.findElements(By.className('monaco-list-row'));
			for (const row of rows) {
				const item = new CustomTreeItem(row, this.section);
				if ((await item.getLabel().catch(() => undefined)) === componentName) {
					return item;
				}
			}
			const topIndex = rows.length > 0 ? await rows[0].getAttribute('data-index') : null;
			if (topIndex === lastTopIndex) {
				break; // the scroll moved nothing — we've reached the bottom without a match.
			}
			lastTopIndex = topIndex;
			// A wheel-scroll gesture is what actually moves this virtualized list; keyboard
			// PageDown/Down don't reach it reliably (they move focus, not the scroll position, unless
			// the list already has real DOM focus). `@types/selenium-webdriver` predates `Actions#scroll`
			// (still typed against the old TouchSequence API), hence the cast. The modest delta keeps
			// each step within the ~30-row rendered window's overlap, so no run of rows goes unscanned.
			await (driver.actions() as unknown as { scroll: (...args: unknown[]) => { perform(): Promise<void> } })
				.scroll(0, 0, 0, 600, list)
				.perform();
			await driver.sleep(75); // let the virtualized rows re-render before the next scan
		}
		throw new Error(`compare entry "${componentName}" not found in the tree (scrolled the whole list)`);
	}
}
