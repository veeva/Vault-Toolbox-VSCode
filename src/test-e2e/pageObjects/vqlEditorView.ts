import {
	By,
	EditorView,
	Key,
	VSBrowser,
	WebElement,
	WebView,
	Workbench,
} from 'vscode-extension-tester';

/** Palette label for the pop-out command (`<category>: <title>` from package.json). */
const POP_OUT_COMMAND = 'Vault Toolbox: Open VQL Editor in Editor Tab';
/** Distinct enough that fuzzy-matching floats it to the top quick pick. */
const POP_OUT_FILTER = 'Open VQL Editor in Editor Tab';
/** The `WebviewPanel` title `ShellPanel` gives the popped-out VQL tab. */
const EDITOR_TITLE = 'VQL Editor';
const OPEN_TIMEOUT_MS = 15000;
/** Generous: covers the activation auto-reconnect handshake (version discovery → user → domain). */
const CONNECT_TIMEOUT_MS = 30000;

/** Exact visible labels of the `.vt-pager` buttons (see `Pagination.tsx`) — the only way to tell the
 *  two apart, since they share the `.vt-btn.secondary` class. */
const PREV_LABEL = '‹ Prev';
const NEXT_LABEL = 'Next ›';
/** Label of the Run button (see `VqlEditor.tsx`); it enables only once the active env is connected. */
const RUN_LABEL = 'Run VQL';

/** Monaco's Run chord is `CtrlCmd+Enter`, which resolves to ⌘ on macOS and Ctrl elsewhere. */
const runModifier = process.platform === 'darwin' ? Key.COMMAND : Key.CONTROL;

/** Monaco 0.55 on Chromium 148 uses the `EditContext` API, so there is no `textarea.inputarea` to
 *  target — the only `textarea` is the readonly `.ime-text-area`. Instead we focus the editor by
 *  clicking its text surface and send keys to whatever element that focuses. */
const MONACO_LINES = '.monaco-editor .view-lines';

/**
 * Page object for the **popped-out** VQL editor webview (`vaultToolbox.popOutVqlEditor` → `ShellPanel`),
 * never the documented-flaky sidebar view. It quarantines all `WebView.switchToFrame()` /
 * `switchBack()` bracketing in one place: every method that touches webview DOM enters the frame, does
 * its work, and switches back even on failure, so a journey never leaks a frame context. VS Code chrome
 * (notifications) is reached through {@link Workbench}, outside the frame.
 */
export class VqlEditorView {
	private readonly webview = new WebView();

	/**
	 * Opens the popped-out editor tab and waits for it to appear, returning a driver for it. Rather
	 * than `Workbench.executeCommand` — whose final `InputBox.confirm()` (Enter on the palette input)
	 * throws `ElementNotInteractableError` on recent Chrome/driver builds — this types the command and
	 * **clicks** the top quick pick, a list row that is reliably interactable.
	 */
	static async open(): Promise<VqlEditorView> {
		const driver = VSBrowser.instance.driver;
		// Clear any frame context a prior (possibly failed) webview test left active, so the palette and
		// the subsequent frame switch start from the top browsing context.
		await driver.switchTo().defaultContent();
		const prompt = await new Workbench().openCommandPrompt();
		await prompt.setText(`>${POP_OUT_FILTER}`);
		await driver.wait(
			async () => (await prompt.getQuickPicks()).length > 0,
			OPEN_TIMEOUT_MS,
			`command "${POP_OUT_COMMAND}" produced no quick picks`,
		);
		await prompt.selectQuickPick(0);
		await driver.wait(
			async () => (await new EditorView().getOpenEditorTitles()).includes(EDITOR_TITLE),
			OPEN_TIMEOUT_MS,
			`the "${EDITOR_TITLE}" editor tab did not open`,
		);
		return new VqlEditorView();
	}

	/** Runs `callback` with the webview frame active, always switching back afterwards. */
	private async inFrame<T>(callback: () => Promise<T>): Promise<T> {
		await this.webview.switchToFrame();
		try {
			return await callback();
		} finally {
			await this.webview.switchBack();
		}
	}

	/** Whether Monaco has mounted inside the webview frame — the harness's frame-switch smoke check. */
	async isEditorMounted(): Promise<boolean> {
		return this.inFrame(async () => {
			const editors = await this.webview.findWebElements(By.css('.monaco-editor'));
			return editors.length > 0;
		});
	}

	/** Types VQL into Monaco, replacing any existing text (without running it). Focuses the editor by
	 *  clicking its text surface (clicking the input directly is intercepted by the highlight spans),
	 *  then sends keys to the focused EditContext input. */
	async setQuery(vql: string): Promise<void> {
		await this.inFrame(async () => {
			const lines = await this.webview.findWebElement(By.css(MONACO_LINES));
			await lines.click();
			const active = await VSBrowser.instance.driver.switchTo().activeElement();
			await active.sendKeys(Key.chord(runModifier, 'a'), vql);
		});
	}

	/** Fires Monaco's Run chord (`CtrlCmd+Enter`). A no-op in the UI unless the query is non-empty and
	 *  the active environment is connected, so callers should {@link waitUntilConnected} first. */
	async submitRun(): Promise<void> {
		await this.inFrame(async () => {
			const lines = await this.webview.findWebElement(By.css(MONACO_LINES));
			await lines.click();
			const active = await VSBrowser.instance.driver.switchTo().activeElement();
			await active.sendKeys(Key.chord(runModifier, Key.ENTER));
		});
	}

	/**
	 * Waits until the active environment is connected, observed through the Run button: it enables only
	 * when connected (with a non-empty query and no run in flight), so a caller that has already typed a
	 * query can treat "Run enabled" as "connected". This is how a journey waits out the activation
	 * auto-reconnect that {@link maybeSeedE2eEnvironment} kicks off, with no host-internal hook.
	 */
	async waitUntilConnected(): Promise<void> {
		await VSBrowser.instance.driver.wait(
			() => this.isRunEnabled(),
			CONNECT_TIMEOUT_MS,
			'the active environment never reported connected (Run button stayed disabled)',
		);
	}

	private async isRunEnabled(): Promise<boolean> {
		return this.inFrame(async () => {
			const buttons = await this.webview.findWebElements(By.css('button.vt-btn'));
			for (const button of buttons) {
				if ((await button.getText()) === RUN_LABEL) {
					return button.isEnabled();
				}
			}
			return false;
		});
	}

	/** Number of body rows currently rendered in the result grid. */
	async getResultRowCount(): Promise<number> {
		return this.inFrame(async () => {
			const rows = await this.webview.findWebElements(By.css('table.vt-grid tbody tr'));
			return rows.length;
		});
	}

	/**
	 * The text of each row's `name__v` cell, in row order. Reads the second `<td>` per row, which for
	 * `SELECT id, name__v` (id then name, no subqueries) is the name — see `deriveGridColumns`. Used to
	 * assert the exact rows a page renders, independent of the `id` values.
	 */
	async getResultNames(): Promise<string[]> {
		return this.inFrame(async () => {
			const rows = await this.webview.findWebElements(By.css('table.vt-grid tbody tr'));
			return Promise.all(
				rows.map(async (row) => {
					const cells = await row.findElements(By.css('td'));
					return cells[1].getText();
				}),
			);
		});
	}

	/** Whether the pager's "Next ›" button is currently clickable (a next-page token exists). */
	async isNextEnabled(): Promise<boolean> {
		return this.isPagerButtonEnabled(NEXT_LABEL);
	}

	/** Whether the pager's "‹ Prev" button is currently clickable (a previous-page token exists). */
	async isPrevEnabled(): Promise<boolean> {
		return this.isPagerButtonEnabled(PREV_LABEL);
	}

	/** Clicks "Next ›" to follow the next-page token, advancing the result grid one page. */
	async clickNext(): Promise<void> {
		await this.clickPagerButton(NEXT_LABEL);
	}

	/** Clicks "‹ Prev" to follow the previous-page token, stepping the result grid back one page. */
	async clickPrev(): Promise<void> {
		await this.clickPagerButton(PREV_LABEL);
	}

	private async isPagerButtonEnabled(label: string): Promise<boolean> {
		return this.inFrame(async () => (await this.findPagerButton(label)).isEnabled());
	}

	private async clickPagerButton(label: string): Promise<void> {
		await this.inFrame(async () => (await this.findPagerButton(label)).click());
	}

	/** Locates a `.vt-pager` button by its exact visible label, since the two buttons share a class. */
	private async findPagerButton(label: string): Promise<WebElement> {
		const buttons = await this.webview.findWebElements(By.css('.vt-pager button'));
		for (const button of buttons) {
			if ((await button.getText()) === label) {
				return button;
			}
		}
		throw new Error(`pager button "${label}" not found`);
	}
}

/**
 * Reads the text of the most recent VS Code notification (deploy/compare journeys surface their
 * outcome as a toast). Lives outside {@link VqlEditorView} because notifications are VS Code chrome,
 * reached through {@link Workbench}, not webview DOM.
 */
export async function latestNotificationText(): Promise<string | undefined> {
	const notifications = await new Workbench().getNotifications();
	const latest = notifications.at(-1);
	return latest ? latest.getMessage() : undefined;
}
