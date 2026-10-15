import * as vscode from 'vscode';
import { isProductionVault } from '../../core/production';
import {
	deriveApplyPlan,
	type ApplyOperation,
	type ApplyPlan,
	type CompareEntry,
	type NamingConvention,
} from '../../core/compare/compareComponents';
import {
	fetchComparison,
	summarizeCodeFetch,
	type CompareVaultPort,
} from '../../core/compare/compareRun';
import {
	applyWrite,
	isApplyWriteSuccess,
	prepareBatch,
	recomputeEntry,
	reportSpecFor,
	type BatchItem,
	type CompareApplyPort,
} from '../../core/compare/compareApply';
import { CUSTOM_CODE_QUERY, customCodeClassNames } from '../../core/sdk/sdkExtraction';
import type { VaultClient } from '../../core/rest/vaultClient';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import type { Environment } from '../../core/models/environment';
import type {
	CompareKinds,
	CompareRequest,
	CompareSessionState,
	HostToCompareMessage,
} from '../../shared/compareProtocol';
import type { ConnectionInfo, ConnectionState } from '../connection/types';
import type { EnvironmentService } from '../environments/environmentService';
import type { OutcomeToastDeps } from '../platform/outcomeToast';
import { runAndReportApiCall } from '../apiHistory/apiCallReport';
import { errorMessage } from '../platform/errors';
import { CompareSession, type ComparePeer } from './compareSession';
import {
	CompareContentProvider,
	CompareCodeLensProvider,
	COMPARE_SCHEME,
	compareUri,
} from './compareContentProvider';
import { CompareTreeProvider, OPEN_DIFF_COMMAND, type CompareNode } from './compareTree';

/** The Vault Compare tree view id (contributed in the `vaultToolbox` container). */
export const COMPARE_VIEW_ID = 'vaultToolbox.compare';

/** Context key mirroring "the current comparison's target is a Production Vault" — gates the apply action. */
const TARGET_PRODUCTION_CONTEXT = 'vaultToolbox.compareTargetProduction';

/** Context key gating the Vault Compare view's visibility — set once a comparison has populated it. */
const COMPARE_ACTIVE_CONTEXT = 'vaultToolbox.compareActive';

/**
 * Formats a comparison's fetch time for the tree view's title-bar description, e.g.
 * "Generated 2026-08-14 2:45 PM PDT".
 */
function formatGeneratedAt(generatedAt: Date): string {
	const formatted = new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short',
	}).format(generatedAt);
	return `Generated ${formatted}`;
}

/**
 * Context key mirroring "apply is enabled for this comparison". Off by default and reset on every new
 * comparison (per-comparison scope): the per-row apply action and its context-menu entry are gated on
 * it, so applying to the target is a deliberate opt-in the user re-confirms each time the target changes.
 */
const APPLY_ENABLED_CONTEXT = 'vaultToolbox.compareApplyEnabled';

/**
 * Context keys mirroring "this view-level filter is narrowing the tree", so the title-bar button can
 * swap to a filled/active icon. Search is active when its query is non-empty; convention is active
 * when it isn't the `all` default. Both are reset on every {@link syncContextKeys} so a filter left
 * active on one comparison doesn't visually leak onto the next.
 */
const SEARCH_ACTIVE_CONTEXT = 'vaultToolbox.compareSearchActive';
const FILTER_ACTIVE_CONTEXT = 'vaultToolbox.compareFilterActive';

/**
 * Context key mirroring "the current comparison has MDL/component entries" — gates the Source
 * filter button, which buckets by naming convention and is meaningless for a code-only comparison.
 */
const HAS_COMPONENTS_CONTEXT = 'vaultToolbox.compareHasComponents';

/** Context key mirroring "at least one entry is checked" — gates the "Apply Selected" toolbar button and the selected-only filter button. */
const APPLY_HAS_SELECTION_CONTEXT = 'vaultToolbox.compareHasSelection';

/** Context key mirroring "the selected-only filter is active" — drives the toolbar button swap. */
const SELECTED_FILTER_ACTIVE_CONTEXT = 'vaultToolbox.compareSelectedFilterActive';

/** Every Vault API call Compare Environments makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-vault-compare';

/** The two connection capabilities Compare needs to target specific Environments by id (ADR 0004). */
export interface CompareConnection {
	run<T>(envId: string, fn: (client: VaultClient) => Promise<T>): Promise<T>;
	getConnectionState(envId: string): ConnectionState;
}

export interface CompareControllerDeps extends OutcomeToastDeps {
	connection: CompareConnection;
	service: EnvironmentService;
	/**
	 * Publish selection state so every live shell webview's Apply Selected button enables/disables
	 * (see `CompareStateBroadcast`). Called on every checkbox change, and after any apply that silently
	 * drops an entry's checked state.
	 */
	notifySelectionChanged(hasSelection: boolean): void;
	/**
	 * Publish the live comparison (or its absence) so a selector can render itself against it. Called
	 * when a comparison becomes current and when one is cleared — not on every checkbox change, since a
	 * selector mid-edit shouldn't be rewritten by state it already knows.
	 */
	notifySessionState(session: CompareSessionState | undefined): void;
}

/** How long to wait after the last keystroke before re-filtering, so each key doesn't re-scan the entry list. */
const SEARCH_DEBOUNCE_MS = 150;

/** The naming-convention choices offered by the filter QuickPick, in display order. */
const CONVENTION_CHOICES: Array<{ label: string; value: NamingConvention }> = [
	{ label: 'All', value: 'all' },
	{ label: 'Custom (__c)', value: 'custom' },
	{ label: 'Standard (__v)', value: 'standard' },
	{ label: 'System (__sys)', value: 'system' },
	{ label: 'Other', value: 'other' },
];

/** A source-filter QuickPick item: a labelled choice carrying its {@link NamingConvention} value. */
export interface ConventionPickItem {
	label: string;
	value: NamingConvention;
	description?: string;
}

/**
 * Build the source-filter QuickPick items, tagging the currently-applied convention with a
 * "current filter" description and returning it as the item to pre-highlight — so opening the
 * filter lands on the active choice rather than always on the top ("All") row.
 */
export function buildConventionPick(currentConvention: NamingConvention): {
	items: ConventionPickItem[];
	activeItem: ConventionPickItem | undefined;
} {
	const items = CONVENTION_CHOICES.map((choice) => ({
		label: choice.label,
		value: choice.value,
		description: choice.value === currentConvention ? 'current filter' : undefined,
	}));
	return { items, activeItem: items.find((item) => item.value === currentConvention) };
}

/**
 * Owns the **Compare Environments** feature's extension surface: the QuickPick source/target flow,
 * the two by-id connections it pulls from, the in-memory {@link CompareSession}, the tree, the diff
 * content provider, the view-level filter/search/show-identical controls, and the one-way apply. All
 * the decision-worthy logic lives in the tested core (`compareComponents`, `compareRun`'s
 * {@link fetchComparison}/{@link summarizeCodeFetch}, `VaultClient`); this is the vscode glue over it,
 * building a {@link CompareVaultPort} per Environment. Re-running the comparison replaces the whole
 * session, discarding the previous snapshot's virtual documents.
 */
export class CompareController {
	private session: CompareSession | undefined;
	/** Unsubscribe for the current session's change listener; replaced on every {@link activate}. */
	private sessionSub: (() => void) | undefined;
	private readonly tree = new CompareTreeProvider(() => this.session);
	private readonly content = new CompareContentProvider(() => this.session);
	private readonly view: vscode.TreeView<CompareNode>;

	constructor(private readonly deps: CompareControllerDeps) {
		this.view = vscode.window.createTreeView(COMPARE_VIEW_ID, {
			treeDataProvider: this.tree,
			manageCheckboxStateManually: true,
		});
	}

	/** Register the view, content provider, and every Compare command; returns their disposables. */
	register(): vscode.Disposable[] {
		return [
			this.view,
			this.content,
			vscode.workspace.registerTextDocumentContentProvider(COMPARE_SCHEME, this.content),
			vscode.languages.registerCodeLensProvider(
				{ scheme: COMPARE_SCHEME },
				new CompareCodeLensProvider(() => this.session),
			),
			vscode.commands.registerCommand(
				'vaultToolbox.compareEnvironmentsWith',
				(request: CompareRequest, signal: AbortSignal) =>
					this.compareWith(request, signal),
			),
			vscode.commands.registerCommand(OPEN_DIFF_COMMAND, (node?: CompareNode) =>
				this.openDiff(node),
			),
			vscode.commands.registerCommand('vaultToolbox.compareToggleIdentical', () =>
				this.toggleIdentical(),
			),
			vscode.commands.registerCommand('vaultToolbox.compareFilterConvention', () =>
				this.filterConvention(),
			),
			vscode.commands.registerCommand('vaultToolbox.compareFilterConventionActive', () =>
				this.filterConvention(),
			),
			vscode.commands.registerCommand('vaultToolbox.compareFilterSelected', () =>
				this.requireSession()?.toggleSelectedOnly(),
			),
			vscode.commands.registerCommand('vaultToolbox.compareFilterSelectedActive', () =>
				this.requireSession()?.toggleSelectedOnly(),
			),
			vscode.commands.registerCommand('vaultToolbox.compareSearch', () => this.search()),
			vscode.commands.registerCommand('vaultToolbox.compareSearchActive', () => this.search()),
			vscode.commands.registerCommand('vaultToolbox.compareApply', (node?: CompareNode) =>
				this.apply(node),
			),
			vscode.commands.registerCommand('vaultToolbox.compareApplySelected', () =>
				this.applySelectedEntries(),
			),
			this.view.onDidChangeCheckboxState((e) => this.handleCheckboxChange(e)),
		];
	}

	/**
	 * Run one comparison end to end for a source/target pair already chosen in the Actions-tab Compare
	 * screen: resolve each id against the saved Environments, guard that both still exist and are
	 * distinct, connect both on demand, pull each Vault's component definitions under a cancellable
	 * progress indicator, then diff and render. An invalid pair, a connection failure, or a cancel stops
	 * the flow and leaves any previous comparison intact rather than clearing to an empty tree.
	 */
	private async compareWith(
		{ sourceId, targetId, kinds }: CompareRequest,
		signal: AbortSignal,
	): Promise<HostToCompareMessage> {
		const envs = this.deps.service.list();
		const source = envs.find((env) => env.id === sourceId);
		const target = envs.find((env) => env.id === targetId);
		if (!source || !target || source.id === target.id) {
			const errorMessage = 'Compare Environments: choose two different saved Environments.';
			void vscode.window.showErrorMessage(errorMessage);
			return { type: 'compareResult', status: 'error', errorMessage };
		}
		if (!kinds.mdl && !kinds.code) {
			const errorMessage = 'Compare Environments: select at least one kind to compare.';
			void vscode.window.showErrorMessage(errorMessage);
			return { type: 'compareResult', status: 'error', errorMessage };
		}

		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Comparing Environments…', cancellable: true },
			(progress, token) => this.buildSession({ source, target }, kinds, progress, token, signal, REFERENCE_ID),
		);

		// The user may have clicked Back while the session was building — don't commit the result.
		if (signal.aborted) {
			return { type: 'compareResult', status: 'success' }; // value ignored by the bus
		}

		if (result.kind === 'cancelled') {
			void vscode.window.showInformationMessage('Compare Environments cancelled.');
			return { type: 'compareResult', status: 'success' }; // return to the tree; nothing was committed
		}

		if (result.kind !== 'success') {
			return { type: 'compareResult', status: 'error', errorMessage: result.errorMessage };
		}

		const { session, codeSummary } = result;
		await this.activate(session);
		if (codeSummary) {
			// Some classes couldn't be retrieved: the comparison is partial. An info toast (not a warning) —
			// the comparison did succeed, partly — naming how many compared of how many and which failed.
			void vscode.window.showInformationMessage(codeSummary);
		}
		if (session.differenceCount === 0) {
			void vscode.window.showInformationMessage(
				`No differences — ${source.label} and ${target.label} match.`,
			);
		}
		return { type: 'compareResult', status: 'success' };
	}

	private async buildSession(
		pair: { source: Environment; target: Environment },
		kinds: CompareKinds,
		progress: vscode.Progress<{ message?: string }>,
		token: vscode.CancellationToken,
		signal: AbortSignal,
		referenceId: ToolboxFeatureArea,
	): Promise<BuildSessionResult> {
		const { source, target } = pair;
		const sourceResult = await this.ensureConnected(source, progress);
		if (signal.aborted) {
			return { kind: 'cancelled' };
		}
		if (sourceResult.kind === 'error') {
			return sourceResult;
		}

		const targetResult = await this.ensureConnected(target, progress);
		if (signal.aborted) {
			return { kind: 'cancelled' };
		}
		if (targetResult.kind === 'error') {
			return targetResult;
		}

		try {
			const fetched = await fetchComparison(
				this.vaultPort(source, referenceId),
				this.vaultPort(target, referenceId),
				kinds,
				{
					isCancelled: () => token.isCancellationRequested || signal.aborted,
					onProgress: (message) => progress.report({ message }),
				},
			);
			if (fetched.kind === 'cancelled') {
				return { kind: 'cancelled' };
			}

			const { data } = fetched;
			const session = new CompareSession({
				source: toPeer(source),
				target: toPeer(target),
				targetIsProduction: isProductionVault(targetResult.info.domain?.domainType, target.vaultDNS),
				mdl: data.mdl,
				code: data.code && { source: data.code.source, target: data.code.target },
			});
			return {
				kind: 'success',
				session,
				codeSummary: data.code ? summarizeCodeFetch(data.code) : undefined,
			};
		} catch (err) {
			const errMessage = `Compare Environments failed: ${errorMessage(err)}`;
			void vscode.window.showErrorMessage(errMessage);
			return { kind: 'error', errorMessage: errMessage };
		}
	}

	/**
	 * Build the pure fetch core's {@link CompareVaultPort} for one Environment: each method is that
	 * Environment's Vault read routed through `connection.run(envId, …)`, so the by-id connection and REST
	 * envelope stay behind this adapter and the orchestration in {@link fetchComparison} stays vscode-free.
	 */
	private vaultPort(env: Environment, referenceId: ToolboxFeatureArea): CompareVaultPort {
		return {
			label: env.vaultDNS,
			fetchComponentDefinitions: (isCancelled) =>
				this.deps.connection.run(env.id, (client) =>
					client.mdl.fetchComponentDefinitions(referenceId, isCancelled),
				),
			queryCustomCodeNames: (isCancelled) =>
				this.deps.connection
					.run(env.id, (client) =>
						client.vql.queryAll(CUSTOM_CODE_QUERY, referenceId, { isCancelled }),
					)
					.then(customCodeClassNames),
			retrieveSourceCode: (className) =>
				this.deps.connection.run(env.id, (client) =>
					client.sdk.retrieveSourceCode(className, referenceId),
				),
		};
	}

	/**
	 * Build the apply core's {@link CompareApplyPort} for the comparison's **target**: each method is a
	 * target-only write or post-apply re-read routed through `connection.run(target.envId, …)`, so the
	 * dispatch and recompute logic in `core/compare/compareApply` stays vscode-free. Apply only ever
	 * writes to the target (ADR 0006), so there is no source-side apply port.
	 */
	private applyPort(target: ComparePeer, referenceId: ToolboxFeatureArea): CompareApplyPort {
		return {
			executeMdl: (script) =>
				this.deps.connection.run(target.envId, (client) => client.mdl.executeMdl(script, referenceId)),
			deploySource: (fileName, bytes) =>
				this.deps.connection.run(target.envId, (client) =>
					client.sdk.addOrReplaceSourceCode(fileName, bytes, referenceId),
				),
			deleteSource: (className) =>
				this.deps.connection.run(target.envId, (client) =>
					client.sdk.deleteSourceCode(className, referenceId),
				),
			retrieveComponentDefinition: (type, name) =>
				this.deps.connection.run(target.envId, (client) =>
					client.mdl.retrieveComponentDefinition(type, name, referenceId),
				),
			retrieveSourceCode: (className) =>
				this.deps.connection.run(target.envId, (client) =>
					client.sdk.retrieveSourceCode(className, referenceId),
				),
		};
	}

	/**
	 * Return `env`'s live connection info, connecting on demand if it isn't already. Never touches
	 * active status — picking an Environment as Compare's source or target must not steal active from
	 * whatever the user has set elsewhere. Returns a discriminated result so the caller can distinguish
	 * a connection failure (reported here via toast) from a successful connection.
	 */
	private async ensureConnected(
		env: Environment,
		progress: vscode.Progress<{ message?: string }>,
	): Promise<{ kind: 'success'; info: ConnectionInfo } | { kind: 'error'; errorMessage: string }> {
		const state = this.deps.connection.getConnectionState(env.id);
		if (state.status === 'connected' && state.info) {
			return { kind: 'success', info: state.info };
		}
		progress.report({ message: `Connecting to ${env.vaultDNS}…` });
		try {
			const info = await this.deps.service.connect(env.id, { makeActive: false });
			return { kind: 'success', info };
		} catch (error) {
			const errMessage = `Could not connect to ${env.label} — ${errorMessage(error)}`;
			void vscode.window.showErrorMessage(errMessage);
			return { kind: 'error', errorMessage: errMessage };
		}
	}

	/**
	 * Open the native diff for an entry: source MDL on the left, target on the right. The tab leads with
	 * the component name and appends both Vaults' names so it stays legible yet always sticky; each
	 * side's full Vault DNS is labeled by a CodeLens header (see {@link CompareCodeLensProvider}).
	 */
	private async openDiff(node?: CompareNode): Promise<void> {
		const session = this.session;
		if (!session || node?.kind !== 'entry') {
			return;
		}
		await this.enableDiffCodeLens();
		const { entry } = node;
		const left = compareUri(entry, 'source', session.source);
		const right = compareUri(entry, 'target', session.target);
		const label = entry.kind === 'code' ? entry.name : `${entry.type} ${entry.name}`;
		const title = `${label} — ${session.source.label} ↔ ${session.target.label}`;
		await vscode.commands.executeCommand('vscode.diff', left, right, title);
	}

	/**
	 * The diff editor suppresses CodeLens unless `diffEditor.codeLens` is on (it defaults off), so our
	 * per-side DNS header would never render. Turn it on the first time a Compare diff is opened —
	 * lazily, only when not already set, and with a one-time notification — so the user knows we made
	 * the change rather than finding a setting silently flipped. Prefer the **workspace** scope so the
	 * change stays with this project, falling back to global when no folder is open (writing a
	 * workspace setting then throws).
	 */
	private async enableDiffCodeLens(): Promise<void> {
		const config = vscode.workspace.getConfiguration('diffEditor');
		if (config.get<boolean>('codeLens') === true) {
			return;
		}
		const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
		const target = hasWorkspace
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;
		await config.update('codeLens', true, target);
		const scope = hasWorkspace ? 'this workspace' : 'your user settings';
		void vscode.window.showInformationMessage(
			`Enabled "diffEditor.codeLens" in ${scope} so Compare can label each side with its Vault.`,
		);
	}

	private toggleIdentical(): void {
		this.requireSession()?.toggleIdentical();
	}

	private async filterConvention(): Promise<void> {
		const session = this.requireSession();
		if (!session) {
			return;
		}
		const { items, activeItem } = buildConventionPick(session.convention);
		const pick = await this.showConventionPick(items, activeItem);
		if (pick) {
			session.setConvention(pick.value);
		}
	}

	/**
	 * Show the source-filter QuickPick with the current filter pre-highlighted. Uses the
	 * builder API (rather than {@link vscode.window.showQuickPick}) so we can set `activeItems`,
	 * which the promise-returning overload can't do.
	 */
	private showConventionPick<T extends vscode.QuickPickItem & { value: NamingConvention }>(
		items: T[],
		activeItem: T | undefined,
	): Promise<T | undefined> {
		return new Promise((resolve) => {
			const quickPick = vscode.window.createQuickPick<T>();
			quickPick.placeholder = 'Filter Components by Source';
			quickPick.items = items;
			if (activeItem) {
				quickPick.activeItems = [activeItem];
			}
			quickPick.onDidAccept(() => {
				resolve(quickPick.activeItems[0]);
				quickPick.hide();
			});
			quickPick.onDidHide(() => {
				resolve(undefined);
				quickPick.dispose();
			});
			quickPick.show();
		});
	}

	/**
	 * Open the name filter as a live input: each keystroke narrows the tree (debounced so a fast typist
	 * doesn't re-scan the entry list per key), rather than the old submit-on-Enter modal. The box seeds
	 * from the current query and clears the filter when emptied. Live filtering means there's nothing to
	 * "cancel" — Escape just closes the box, leaving whatever's typed applied — so the final value is
	 * flushed on hide in case a keystroke is still within the debounce window.
	 */
	private search(): void {
		const session = this.requireSession();
		if (!session) {
			return;
		}
		const input = vscode.window.createInputBox();
		input.prompt = 'Filter entries by name (empty to clear)';
		input.value = session.search;
		let debounce: ReturnType<typeof setTimeout> | undefined;
		input.onDidChangeValue((value) => {
			clearTimeout(debounce);
			debounce = setTimeout(() => session.setSearch(value), SEARCH_DEBOUNCE_MS);
		});
		input.onDidAccept(() => input.hide());
		input.onDidHide(() => {
			clearTimeout(debounce);
			session.setSearch(input.value);
			input.dispose();
		});
		input.show();
	}

	/**
	 * Make `session` the current comparison: swap the change subscription, sync the context keys,
	 * repaint, and focus. The single commit point {@link compareWith} converges
	 * on — a new session is applyEnabled-off by construction, so there's no separate "reset apply" step.
	 */
	private async activate(session: CompareSession): Promise<void> {
		this.sessionSub?.();
		this.session = session;
		this.sessionSub = session.onDidChange(() => {
			this.tree.refresh();
			void this.syncContextKeys(session);
		});
		this.view.description = formatGeneratedAt(session.generatedAt);
		// Pushed, not merely replayed on request: a selector rebuilt *while this comparison was still
		// running* asked before there was anything to tell it, and would otherwise sit empty and
		// unlocked above a populated tree, having also missed the compare result addressed to the
		// webview it replaced.
		this.deps.notifySessionState(this.sessionState());
		await this.syncContextKeys(session);
		this.tree.refresh();
		await this.enableTreeFilterMode();
		await vscode.commands.executeCommand(`${COMPARE_VIEW_ID}.focus`);
		this.repaintAfterColdFirstPaint();
	}

	/**
	 * Work around a VS Code TreeView cold-first-paint bug: the *very first* render of the Vault Compare
	 * view — when a comparison flips {@link COMPARE_ACTIVE_CONTEXT} and `.focus` materializes the view at
	 * the same moment the tree's change event fires — can mis-place a row (an MDL entry ghosts under the
	 * Code section, with the real code tree missing). It is purely a renderer reconciliation artifact: the
	 * data path never emits an MDL entry under Code (both kinds are `kind`-filtered), and *any* second
	 * repaint reconciles cleanly — which is exactly why a manual filter toggle, or an earlier compare that
	 * already warmed the view, "fixes" it. Force that warm repaint one tick after the first paint has
	 * settled so the first comparison renders correctly with no user interaction. A no-op cost on later
	 * comparisons (the view is already warm). See {@link CompareTreeProvider}.
	 */
	private repaintAfterColdFirstPaint(): void {
		setTimeout(() => this.tree.refresh(), 0);
	}

	/**
	 * VS Code's built-in tree find widget (Ctrl/Cmd+F while the view is focused) defaults to *highlight*
	 * mode, which only jumps between matches. Switch it to *filter* mode so typing in the widget hides
	 * non-matching rows — an in-tree complement to the title-bar name search. `defaultFindMode` is a
	 * workspace/global list setting (there's no per-view API), so, like {@link enableDiffCodeLens}, flip
	 * it lazily and only when unset, prefer the workspace scope to contain the blast radius, and notify
	 * once so the user knows we changed it rather than finding a setting silently flipped.
	 */
	private async enableTreeFilterMode(): Promise<void> {
		const config = vscode.workspace.getConfiguration('workbench.list');
		if (config.get<string>('defaultFindMode') === 'filter') {
			return;
		}
		const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
		const target = hasWorkspace
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;
		await config.update('defaultFindMode', 'filter', target);
		const scope = hasWorkspace ? 'this workspace' : 'your user settings';
		void vscode.window.showInformationMessage(
			`Set "workbench.list.defaultFindMode" to "filter" in ${scope} so pressing Ctrl/Cmd+F in a ` +
				'tree (including Vault Compare) filters rows instead of just highlighting matches.',
		);
	}

	/**
	 * Mirror the session's facts into the vscode context keys that gate the view, its apply action, the
	 * filter buttons' active icons, and the Source filter button's visibility. `APPLY_ENABLED`,
	 * the two filter-active keys, and `HAS_COMPONENTS` are set on every call (not just on change) or a
	 * prior comparison's state would leak onto this one. `COMPARE_ACTIVE` is awaited because the
	 * subsequent focus gates on the view's visibility; the rest need only eventual consistency.
	 *
	 * Also publishes the selection across the webview boundary, since the same set of facts drives the
	 * webview's Apply Selected button — callers that change checked state (including the silent drops in
	 * {@link applyRecompute}) go through here for exactly that. A call for anything but the current
	 * comparison is dropped.
	 */
	private async syncContextKeys(session: CompareSession): Promise<void> {
		if (session !== this.session) {
			// A superseded or cleared comparison must not re-assert itself: an apply that was already
			// in flight when "New Compare" was clicked still recomputes its entries afterwards, and
			// would otherwise switch the view back on and publish the dead comparison's selection.
			return;
		}
		this.setContextKeys([
			[TARGET_PRODUCTION_CONTEXT, session.targetIsProduction],
			[APPLY_ENABLED_CONTEXT, session.applyEnabled],
			[APPLY_HAS_SELECTION_CONTEXT, session.selectionCount > 0],
			[SEARCH_ACTIVE_CONTEXT, session.searchActive],
			[FILTER_ACTIVE_CONTEXT, session.filterActive],
			[SELECTED_FILTER_ACTIVE_CONTEXT, session.selectedFilterActive],
			[HAS_COMPONENTS_CONTEXT, session.fetchedMdl],
		]);
		// Published before the awaited context-key call: the webview's Apply Selected button has no
		// dependency on that round-trip, and shouldn't be held up (or skipped, if it rejects) by it.
		this.deps.notifySelectionChanged(session.selectionCount > 0);
		await vscode.commands.executeCommand('setContext', COMPARE_ACTIVE_CONTEXT, true);
	}

	/**
	 * Apply a single entry one-way (source → target). Enforces the two shared gates — the "Enable Apply
	 * to Target" opt-in and the Production-target block (re-checked *live* here, not from the load-time
	 * snapshot) — then dispatches by kind: MDL executes/drops via MDL Execute, code deploys/deletes via
	 * the SDK-code endpoints. Both confirm first (a distinctly stronger confirmation for a destructive
	 * delete), report through the shared outcome toast, and recompute the entry from the target on success.
	 */
	private async apply(node?: CompareNode): Promise<void> {
		const session = this.session;
		if (!session || node?.kind !== 'entry') {
			return;
		}
		const { entry } = node;
		const plan = deriveApplyPlan(entry);
		if (!plan) {
			return;
		}

		if (!session.applyEnabled) {
			void vscode.window.showInformationMessage(
				'Enable Apply to Target Vault first — use the checkbox in the Compare Environments tab.',
			);
			return;
		}

		if (this.targetIsLiveProduction(session)) {
			await vscode.window.showErrorMessage(
				`Apply is disabled: ${session.target.vaultDNS} is a Production Vault.`,
				{
					modal: true,
					detail:
						'Compare Environments never writes to a Production Vault. You can pull from Production ' +
						'as the source, but the target must be a sandbox.',
				},
			);
			return;
		}

		await this.applyConfirmed(session, entry, plan, REFERENCE_ID);
	}

	/**
	 * Apply one entry one-way (source → target) once {@link apply}'s gates have passed: confirm (a
	 * distinctly stronger confirmation for a destructive drop/delete), run the derived write via the
	 * apply core under the shared outcome toast — fed the operation's call shape and summary by
	 * {@link reportSpecFor} so **View API Call** deep-links correctly — and recompute the entry from the
	 * target on success.
	 */
	private async applyConfirmed(
		session: CompareSession,
		entry: CompareEntry,
		plan: ApplyPlan,
		referenceId: ToolboxFeatureArea,
	): Promise<void> {
		if (!(await this.confirmApplyFor(entry, plan, session.target.vaultDNS))) {
			return;
		}
		const port = this.applyPort(session.target, referenceId);
		const spec = reportSpecFor(plan.operation);
		const ok = await runAndReportApiCall(this.deps, {
			progressTitle: applyProgressTitle(plan, entry, session.target.vaultDNS),
			failurePrefix: `Apply to ${session.target.vaultDNS} failed:`,
			isCall: spec.isCall,
			summarize: spec.summarize,
			execute: () => applyWrite(plan, port),
		});
		if (ok) {
			await this.applyRecompute(session, entry, plan.operation, port);
		}
	}

	/** Confirm an apply, dispatching to the right dialog by operation (stronger wording for a destructive drop/delete). */
	private confirmApplyFor(entry: CompareEntry, plan: ApplyPlan, targetDNS: string): Thenable<boolean> {
		switch (plan.operation) {
			case 'execute':
			case 'drop':
				return this.confirmApply(entry, plan.operation, targetDNS);
			case 'deploy':
				return this.confirmCodeDeploy(entry, targetDNS);
			case 'delete':
				return this.confirmCodeDelete(plan.className, targetDNS);
		}
	}

	/**
	 * Re-check the target against Production at apply time, reading the *current* connection state
	 * rather than the comparison's load-time snapshot so a stale snapshot can't slip a write in. Fails
	 * closed: if the live domain info is missing (e.g. the session dropped and `info` was cleared), the
	 * load-time `targetIsProduction` still blocks — the guard degrades to *stricter*, never open.
	 */
	private targetIsLiveProduction(session: CompareSession): boolean {
		const state = this.deps.connection.getConnectionState(session.target.envId);
		return (
			isProductionVault(state.info?.domain?.domainType, session.target.vaultDNS) ||
			session.targetIsProduction
		);
	}

	private confirmApply(
		entry: CompareEntry,
		operation: ApplyOperation,
		targetDNS: string,
	): Thenable<boolean> {
		if (operation === 'drop') {
			return vscode.window
				.showWarningMessage(
					`Delete ${entry.type} "${entry.name}" from ${targetDNS}?`,
					{
						modal: true,
						detail:
							`This permanently DROPs the component from ${targetDNS}. This is destructive and ` +
							'cannot be undone.',
					},
					'Delete from Target',
				)
				.then((choice) => choice === 'Delete from Target');
		}
		const action = entry.status === 'source-only' ? 'Create' : 'Update';
		return vscode.window
			.showWarningMessage(
				`${action} ${entry.type} "${entry.name}" on ${targetDNS}?`,
				{
					modal: true,
					detail: `This executes the source definition against ${targetDNS} via MDL Execute.`,
				},
				`${action} on Target`,
			)
			.then((choice) => choice === `${action} on Target`);
	}

	/**
	 * Confirm a code create/update: deploying the source Vault's source of `entry` to the target via
	 * Deploy Java SDK Code. A `source-only` class reads as a Create, a `modified` class as an Update.
	 */
	private confirmCodeDeploy(entry: CompareEntry, targetDNS: string): Thenable<boolean> {
		const action = entry.status === 'source-only' ? 'Create' : 'Update';
		return vscode.window
			.showWarningMessage(
				`${action} Vault Java SDK class "${entry.name}" on ${targetDNS}?`,
				{
					modal: true,
					detail: `This deploys the source Vault's source to ${targetDNS} via Deploy Java SDK Code.`,
				},
				`${action} on Target`,
			)
			.then((choice) => choice === `${action} on Target`);
	}

	/**
	 * Confirm a destructive code delete: the distinctly stronger, irreversible confirmation naming the
	 * exact fully-qualified class and the target Vault (parity with MDL's `DROP`).
	 */
	private confirmCodeDelete(className: string, targetDNS: string): Thenable<boolean> {
		return vscode.window
			.showWarningMessage(
				`Delete Vault Java SDK class "${className}" from ${targetDNS}?`,
				{
					modal: true,
					detail:
						`This permanently removes the class from ${targetDNS} via Delete Java SDK Code. This is ` +
						'destructive and cannot be undone.',
				},
				'Delete from Target',
			)
			.then((choice) => choice === 'Delete from Target');
	}

	/**
	 * After a successful apply, re-read the entry from the target via the apply core and update it
	 * honestly: {@link recomputeEntry} decides whether the entry is replaced with a freshly-classified
	 * one (Identical/Modified, or Unavailable for code whose source can't be read back), removed (a
	 * dropped/deleted entry now on neither side), or left unchanged. Refresh the tree and both diff
	 * sides so each reflects the new state.
	 */
	private async applyRecompute(
		session: CompareSession,
		entry: CompareEntry,
		operation: ApplyOperation,
		port: CompareApplyPort,
	): Promise<void> {
		const result = await recomputeEntry(entry, operation, port);
		if (result.kind === 'replace') {
			session.replaceEntry(result.entry);
		} else if (result.kind === 'remove') {
			session.removeEntry(entry.type, entry.name);
		}
		this.tree.refresh();
		// Both mutations drop the entry's checked state (it is no longer applicable) without firing the
		// session's change event, so sync here or the selection-gated controls would outlive the selection.
		void this.syncContextKeys(session);
		this.content.refresh(compareUri(entry, 'source', session.source));
		this.content.refresh(compareUri(entry, 'target', session.target));
	}

	/** Relay checkbox changes from the tree view into session state. */
	private handleCheckboxChange(e: vscode.TreeCheckboxChangeEvent<CompareNode>): void {
		const session = this.session;
		if (!session) {
			return;
		}
		for (const [node, state] of e.items) {
			if (node.kind === 'entry') {
				session.setChecked(node.entry, state === vscode.TreeItemCheckboxState.Checked);
			}
		}
	}

	/**
	 * Apply all checked entries to the target, sequentially (MDL first, then SDK code). Confirms once
	 * with a summary dialog before proceeding. Continues on error; shows a final counts toast.
	 */
	private async applySelectedEntries(): Promise<void> {
		const session = this.session;
		if (!session) {
			return;
		}

		if (!session.applyEnabled) {
			void vscode.window.showInformationMessage(
				'Enable Apply to Target Vault first — use the checkbox in the Compare Environments tab.',
			);
			return;
		}

		if (this.targetIsLiveProduction(session)) {
			await vscode.window.showErrorMessage(
				`Apply is disabled: ${session.target.vaultDNS} is a Production Vault.`,
				{
					modal: true,
					detail:
						'Compare Environments never writes to a Production Vault. You can pull from Production ' +
						'as the source, but the target must be a sandbox.',
				},
			);
			return;
		}

		const batch = prepareBatch(session.checkedEntries());
		if (batch.length === 0) {
			return;
		}

		const { title, detail } = buildBatchSummary(batch, session.target.vaultDNS);
		const confirmed = await vscode.window.showWarningMessage(title, { modal: true, detail }, 'Apply All');
		if (confirmed !== 'Apply All') {
			return;
		}

		let succeeded = 0;
		let failed = 0;
		const port = this.applyPort(session.target, REFERENCE_ID);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Applying',
				cancellable: false,
			},
			async (progress) => {
				for (let i = 0; i < batch.length; i++) {
					progress.report({ message: `component ${i + 1} of ${batch.length} to ${session.target.vaultDNS}…` });
					const ok = await this.applyOneBatchItem(session, batch[i], port);
					if (ok) {
						succeeded++;
					} else {
						failed++;
					}
				}
			},
		);

		void this.syncContextKeys(session);

		const total = batch.length;
		if (failed === 0) {
			void vscode.window.showInformationMessage(
				`Applied ${succeeded} of ${total} component${total === 1 ? '' : 's'} to ${session.target.vaultDNS}.`,
			);
		} else {
			void vscode.window.showWarningMessage(
				`Applied ${succeeded} of ${total} component${total === 1 ? '' : 's'} to ${session.target.vaultDNS}. ${failed} failed — check API History for details.`,
			);
		}
	}

	/**
	 * Execute one batch item against the target without a confirm dialog or per-item toast (the batch
	 * confirms once upfront and reports a final counts toast). Returns whether it succeeded. On success,
	 * recomputes the entry from the target so the tree updates inline.
	 */
	private async applyOneBatchItem(
		session: CompareSession,
		{ entry, plan }: BatchItem,
		port: CompareApplyPort,
	): Promise<boolean> {
		try {
			const result = await applyWrite(plan, port);
			if (!isApplyWriteSuccess(plan.operation, result)) {
				return false;
			}
			await this.applyRecompute(session, entry, plan.operation, port);
			return true;
		} catch {
			return false;
		}
	}

	/** Apply all checked entries; called by the compare bus on a webview message. */
	applySelected(): void {
		void this.applySelectedEntries();
	}

	/**
	 * The live comparison as the selector needs to render itself, or `undefined` when there is none —
	 * called by the compare bus when a selector mounts, so a webview rebuilt over an existing comparison
	 * (after a window reload, say) shows the pair and kinds it is attached to instead of an empty form.
	 */
	sessionState(): CompareSessionState | undefined {
		const session = this.session;
		if (!session) {
			return undefined;
		}
		return {
			sourceId: session.source.envId,
			targetId: session.target.envId,
			kinds: { mdl: session.fetchedMdl, code: session.fetchedCode },
			applyEnabled: session.applyEnabled,
		};
	}

	/** Toggle apply-enabled for the current comparison; called by the compare bus on a webview message. */
	setApplyEnabled(enabled: boolean): void {
		const session = this.session;
		if (!session) { return; }
		session.setApplyEnabled(enabled);
		void this.syncContextKeys(session);
		this.tree.refresh();
	}

	/**
	 * Discard the current comparison: called by the compare bus when the webview's "New Compare" control
	 * is clicked. Drops the session (so the tree empties and, via {@link COMPARE_ACTIVE_CONTEXT}, the
	 * Vault Compare view hides itself per its `when` clause), closes any open diff tabs it backs, and
	 * resets every context key this feature owns so a cleared comparison never leaves a stale flag behind
	 * for the next one. A no-op when there's nothing to clear.
	 */
	clearCompare(): void {
		if (!this.session) {
			return;
		}
		this.sessionSub?.();
		this.sessionSub = undefined;
		this.session = undefined;
		this.view.description = undefined;
		this.tree.refresh();
		void this.closeOpenDiffTabs();
		void this.clearContextKeys();
		this.deps.notifySelectionChanged(false);
		this.deps.notifySessionState(undefined);
	}

	/** Close every open diff editor tab backed by the Compare content provider's `vault-compare` scheme. */
	private async closeOpenDiffTabs(): Promise<void> {
		const tabs = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.input instanceof vscode.TabInputTextDiff && isCompareDiffInput(tab.input));
		if (tabs.length > 0) {
			await vscode.window.tabGroups.close(tabs);
		}
	}

	/** Reset every context key this feature owns to its inactive default. */
	private async clearContextKeys(): Promise<void> {
		this.setContextKeys([
			[TARGET_PRODUCTION_CONTEXT, false],
			[APPLY_ENABLED_CONTEXT, false],
			[APPLY_HAS_SELECTION_CONTEXT, false],
			[SEARCH_ACTIVE_CONTEXT, false],
			[FILTER_ACTIVE_CONTEXT, false],
			[SELECTED_FILTER_ACTIVE_CONTEXT, false],
			[HAS_COMPONENTS_CONTEXT, false],
		]);
		await vscode.commands.executeCommand('setContext', COMPARE_ACTIVE_CONTEXT, false);
	}

	/** Fire-and-forget `setContext` for each key/value pair; callers await the final gating key separately. */
	private setContextKeys(entries: Array<[string, boolean]>): void {
		for (const [key, value] of entries) {
			void vscode.commands.executeCommand('setContext', key, value);
		}
	}

	private requireSession(): CompareSession | undefined {
		if (!this.session) {
			void vscode.window.showInformationMessage('Run "Vault: Compare Environments" first.');
		}
		return this.session;
	}

}

/** Whether a diff tab's input is a Compare Environments diff (either side on the `vault-compare` scheme). */
function isCompareDiffInput(input: vscode.TabInputTextDiff): boolean {
	return input.original.scheme === COMPARE_SCHEME || input.modified.scheme === COMPARE_SCHEME;
}

/** Project a saved Environment onto the session's peer shape (id + DNS + label). */
function toPeer(env: Environment): ComparePeer {
	return { envId: env.id, vaultDNS: env.vaultDNS, label: env.label };
}

/** The progress-notification title for a single apply, phrased per operation (matching the old per-kind wording). */
function applyProgressTitle(plan: ApplyPlan, entry: CompareEntry, targetDNS: string): string {
	switch (plan.operation) {
		case 'execute':
			return `Applying ${entry.name} on ${targetDNS}…`;
		case 'drop':
			return `Deleting ${entry.name} on ${targetDNS}…`;
		case 'deploy':
			return `Deploying ${plan.className} to ${targetDNS}…`;
		case 'delete':
			return `Deleting ${plan.className} from ${targetDNS}…`;
	}
}

/**
 * Build the one-time summary confirmation dialog content for a batch apply. Each section shows
 * category counts (creates, updates, drops/deletes), not individual component names.
 */
export function buildBatchSummary(
	batch: BatchItem[],
	targetDNS: string,
): { title: string; detail: string } {
	const count = batch.length;
	const title = `Apply ${count} change${count === 1 ? '' : 's'} to ${targetDNS}`;

	const mdlDrops = batch.filter(({ entry, plan }) => entry.kind === 'mdl' && plan.operation === 'drop').length;
	const mdlCreates = batch.filter(({ entry, plan }) => entry.kind === 'mdl' && plan.operation === 'execute' && entry.status === 'source-only').length;
	const mdlUpdates = batch.filter(({ entry, plan }) => entry.kind === 'mdl' && plan.operation === 'execute' && entry.status !== 'source-only').length;
	const codeDeletes = batch.filter(({ entry, plan }) => entry.kind === 'code' && plan.operation === 'delete').length;
	const codeCreates = batch.filter(({ entry, plan }) => entry.kind === 'code' && plan.operation === 'deploy' && entry.status === 'source-only').length;
	const codeUpdates = batch.filter(({ entry, plan }) => entry.kind === 'code' && plan.operation === 'deploy' && entry.status !== 'source-only').length;

	const lines: string[] = [];

	const indent = '· ';

	if (mdlDrops > 0 || mdlCreates > 0 || mdlUpdates > 0) {
		lines.push('Components:');
		if (mdlCreates > 0) lines.push(`${indent}Creates: ${mdlCreates}`);
		if (mdlUpdates > 0) lines.push(`${indent}Updates: ${mdlUpdates}`);
		if (mdlDrops > 0) lines.push(`${indent}Drops: ${mdlDrops}`);
	}

	if (codeDeletes > 0 || codeCreates > 0 || codeUpdates > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('Code:');
		if (codeCreates > 0) lines.push(`${indent}Creates: ${codeCreates}`);
		if (codeUpdates > 0) lines.push(`${indent}Updates: ${codeUpdates}`);
		if (codeDeletes > 0) lines.push(`${indent}Deletes: ${codeDeletes}`);
	}

	return { title, detail: lines.join('\n') };
}

/**
 * Return type of {@link CompareController.buildSession}: a populated session (optionally with a
 * partial-code-fetch `codeSummary` to surface), a cancellation (nothing committed, previous comparison
 * left intact), or the failure reason.
 */
type BuildSessionResult =
	| { kind: 'success'; session: CompareSession; codeSummary: string | undefined }
	| { kind: 'cancelled' }
	| { kind: 'error'; errorMessage: string };
