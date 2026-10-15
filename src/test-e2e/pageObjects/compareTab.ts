import {
	ActivityBar,
	By,
	EditorView,
	Key,
	VSBrowser,
	WebElement,
	WebviewView,
} from 'vscode-extension-tester';
import { runPaletteCommand } from './harness';

const VIEW_CONTAINER = 'Vault Toolbox';

const READY_TIMEOUT_MS = 15000;
const OPTION_TIMEOUT_MS = 10000;

/** react-select `classNamePrefix` for both compare comboboxes (see `VtSelect`/`CompareSelector`). */
const SOURCE_INPUT = '#vt-compare-source';
const TARGET_INPUT = '#vt-compare-target';
const OPTION = '.vt-rs__option';
const COMPARE_LABEL = 'Compare';

/**
 * Page object for the dedicated **Compare Environments** tab. Unlike the VQL editor, this tab can't be
 * popped out to an editor tab (only `vql`/`apiHistory` are poppable), so it is driven in the sidebar
 * shell **`WebviewView`** — the editor area is closed first so that view's iframe is the only webview on
 * screen and `WebviewView` resolves it unambiguously. As in {@link ../../pageObjects/vqlEditorView},
 * every `switchToFrame`/`switchBack` is quarantined in one `inFrame` helper. The source/target pickers
 * are react-select comboboxes (`.vt-rs__*`); choosing a value means opening the menu, typing to filter,
 * and clicking the matching option.
 */
export class CompareTab {
	private readonly webview = new WebviewView();

	/** Opens the Compare Environments tab in the sidebar and waits for its comboboxes to render. */
	static async open(): Promise<CompareTab> {
		// Clear any frame context a prior (possibly failed) webview test left active.
		await VSBrowser.instance.driver.switchTo().defaultContent();
		// Leave only the sidebar webview on screen so `WebviewView` picks the right iframe.
		await new EditorView().closeAllEditors();
		const control = await new ActivityBar().getViewControl(VIEW_CONTAINER);
		if (!control) {
			throw new Error(`view container "${VIEW_CONTAINER}" not found`);
		}
		await control.openView();
		await runPaletteCommand('Vault Toolbox: Compare Environments');
		const screen = new CompareTab();
		await screen.waitReady();
		return screen;
	}

	private async inFrame<T>(callback: () => Promise<T>): Promise<T> {
		await this.webview.switchToFrame();
		try {
			return await callback();
		} finally {
			await this.webview.switchBack();
		}
	}

	private async waitReady(): Promise<void> {
		await VSBrowser.instance.driver.wait(
			() =>
				this.inFrame(async () => {
					const inputs = await this.webview.findWebElements(By.css(SOURCE_INPUT));
					return inputs.length > 0;
				}),
			READY_TIMEOUT_MS,
			'the Compare Environments tab’s source combobox never rendered',
		);
	}

	async chooseSource(label: string): Promise<void> {
		await this.chooseOption(SOURCE_INPUT, label);
	}

	async chooseTarget(label: string): Promise<void> {
		await this.chooseOption(TARGET_INPUT, label);
	}

	/**
	 * Unticks the **Code (Vault Java SDK)** toggle, leaving an MDL-only comparison. Both kind toggles
	 * default on; this keeps a journey that only exercises MDL from also fetching code (which its
	 * cassette doesn't record).
	 */
	async deselectCode(): Promise<void> {
		await this.setKind('#vt-compare-kind-code', false);
	}

	/**
	 * Ticks the **Components (MDL)** and **Code (Vault Java SDK)** toggles so a comparison fetches both.
	 * The toggle state persists in the webview across the session, so a prior MDL-only journey can leave
	 * Code unticked — a both-kinds journey must set them explicitly rather than trust the default.
	 */
	async selectBothKinds(): Promise<void> {
		await this.setKind('#vt-compare-kind-mdl', true);
		await this.setKind('#vt-compare-kind-code', true);
	}

	/** Drives a kind checkbox to `selected`, clicking only when it isn't already in that state. */
	private async setKind(selector: string, selected: boolean): Promise<void> {
		await this.inFrame(async () => {
			const checkbox = await this.webview.findWebElement(By.css(selector));
			if ((await checkbox.isSelected()) !== selected) {
				await checkbox.click();
			}
		});
	}

	/** Runs the comparison; enabled only once source and target are chosen and distinct. */
	async compare(): Promise<void> {
		await this.inFrame(async () => {
			const button = await this.findButtonByText(COMPARE_LABEL);
			await button.click();
		});
	}

	/**
	 * Selects `label` in a react-select combobox by typing to filter and pressing Enter to accept the
	 * highlighted option — rather than clicking an option element, whose reference goes stale as
	 * react-select re-renders the menu on each keystroke. Waits until the menu has *filtered down to
	 * only* the intended option before Enter: the source combobox pre-fills with the active Environment
	 * (see `CompareTab`), so pressing Enter while broader options are still shown would re-accept that
	 * default instead of the typed value. Then confirms the value committed so a mis-selection fails
	 * here rather than opaquely downstream.
	 */
	private async chooseOption(inputSelector: string, label: string): Promise<void> {
		await this.inFrame(async () => {
			const input = await this.webview.findWebElement(By.css(inputSelector));
			await input.click();
			await input.sendKeys(label);
			await this.waitForOnlyOption(label);
			await input.sendKeys(Key.ENTER);
			await this.waitForSelectedValue(inputSelector, label);
		});
	}

	/** Waits until the filtered menu has narrowed to exactly one option and it matches `label`, so the
	 *  highlighted (first) row Enter accepts is unambiguously the intended one. A menu option renders two
	 *  lines (label + a muted DNS sublabel; see `VtSelect.formatOptionLabel`), so match by substring, not
	 *  equality. Assumes the webview frame is active; swallows per-element staleness from react-select's
	 *  mid-render churn. */
	private async waitForOnlyOption(label: string): Promise<void> {
		await VSBrowser.instance.driver.wait(
			async () => {
				const options = await this.webview.findWebElements(By.css(OPTION));
				if (options.length !== 1) {
					return false;
				}
				try {
					return (await options[0].getText()).includes(label);
				} catch {
					// Option detached between query and read as the menu re-rendered — retry next poll.
					return false;
				}
			},
			OPTION_TIMEOUT_MS,
			`menu never filtered to only option "${label}"`,
		);
	}

	/** Waits until the combobox's committed single value shows `label`, proving Enter accepted the
	 *  intended option. `inputSelector` is the input's `#id`; its sibling `.vt-rs__single-value` in the
	 *  same control carries the selected label (see `VtSelect.formatOptionLabel`, which shows label only
	 *  in the value chip). */
	private async waitForSelectedValue(inputSelector: string, label: string): Promise<void> {
		await VSBrowser.instance.driver.wait(
			async () => {
				for (const value of await this.webview.findWebElements(By.css('.vt-rs__single-value'))) {
					try {
						if ((await value.getText()).includes(label)) {
							return true;
						}
					} catch {
						// Value chip re-rendered between query and read — retry next poll.
					}
				}
				return false;
			},
			OPTION_TIMEOUT_MS,
			`combobox "${inputSelector}" never committed to "${label}"`,
		);
	}

	/** Assumes the webview frame is already active. Distinguishes buttons that share `.vt-btn`. */
	private async findButtonByText(text: string): Promise<WebElement> {
		for (const button of await this.webview.findWebElements(By.css('button.vt-btn'))) {
			if ((await button.getText()).trim() === text) {
				return button;
			}
		}
		throw new Error(`button "${text}" not found on the Compare Environments tab`);
	}
}
