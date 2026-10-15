import { InputBox, Notification, VSBrowser, Workbench } from 'vscode-extension-tester';

const QUICK_PICK_TIMEOUT_MS = 15000;
/** Generous: notifications for connect/deploy arrive after a full replay handshake round-trip. */
const NOTIFICATION_TIMEOUT_MS = 30000;

/**
 * Runs a palette command by **clicking** its top quick pick rather than `Workbench.executeCommand`,
 * whose confirm-Enter throws `ElementNotInteractableError` on recent driver builds (see the note in
 * {@link ../../pageObjects/vqlEditorView}). `filter` is a fragment of the `<category>: <title>` label
 * distinctive enough to float the command to the top.
 */
export async function runPaletteCommand(filter: string): Promise<void> {
	const driver = VSBrowser.instance.driver;
	const prompt = await new Workbench().openCommandPrompt();
	await prompt.setText(`>${filter}`);
	await driver.wait(
		async () => (await prompt.getQuickPicks()).length > 0,
		QUICK_PICK_TIMEOUT_MS,
		`command "${filter}" produced no quick picks`,
	);
	await prompt.selectQuickPick(0);
}

/**
 * Chooses `label` from the quick pick a command opens afterwards (e.g. the environment list behind
 * "Connect"/"Disconnect"). Types `label` to *filter* the list, then clicks the first surviving row —
 * rather than scanning rows for a substring match. The filter path is essential because the active
 * environment renders with a `$(star-full)` icon prefix (see `resolveEnvironment`), and that icon
 * defeats `selectQuickPick`'s label substring match — so disconnecting the just-connected (hence
 * active) environment would silently no-op. The label's distinctive words (e.g. "MDL") keep the fuzzy
 * filter down to the one intended row. Waits for rows both before and after filtering, since the quick
 * pick opens a beat after the command and re-renders as it filters.
 */
export async function pickQuickPick(label: string): Promise<void> {
	const input = await InputBox.create();
	const driver = VSBrowser.instance.driver;
	await driver.wait(
		async () => (await input.getQuickPicks()).length > 0,
		QUICK_PICK_TIMEOUT_MS,
		`quick pick to choose "${label}" never rendered`,
	);
	await input.setText(label);
	try {
		await driver.wait(
			async () => (await input.getQuickPicks()).length > 0,
			QUICK_PICK_TIMEOUT_MS,
			`quick pick never filtered to a row for "${label}"`,
		);
	} catch (error) {
		// Surface whatever rows are actually visible — the label may not be what's expected (e.g.
		// `EnvironmentService.connect` renames an env to the Vault's own reported name once connected).
		const labels = await Promise.all(
			(await input.getQuickPicks()).map((row) => row.getLabel().catch((e) => `<err: ${e}>`)),
		);
		throw new Error(`${(error as Error).message}. Visible rows: ${JSON.stringify(labels)}`);
	}
	await input.selectQuickPick(0);
}

/**
 * Disconnects one environment by its label through the palette "Disconnect" command + its quick pick —
 * the UI path a user takes. Relies on the label being stable (the E2E compare/code envs are seeded with
 * `hasCustomLabel`, so Compare's on-demand connect doesn't rename them out from under this). Used by the
 * Compare journeys to free their two on-demand connections so a later journey stays within the connected
 * cap (see `connectionManager` MAX_CONNECTED).
 */
export async function disconnectEnv(label: string): Promise<void> {
	await runPaletteCommand('Vault Toolbox: Disconnect');
	await pickQuickPick(label);
}

/** Resolves with the first current notification whose message matches `pattern`, polling until one does. */
export async function waitForNotification(pattern: RegExp): Promise<Notification> {
	let match: Notification | undefined;
	await VSBrowser.instance.driver.wait(
		async () => {
			for (const notification of await new Workbench().getNotifications()) {
				if (pattern.test(await notification.getMessage())) {
					match = notification;
					return true;
				}
			}
			return false;
		},
		NOTIFICATION_TIMEOUT_MS,
		`no notification matched ${pattern}`,
	);
	// The predicate set `match` before returning true, so the assertion holds.
	return match as Notification;
}
