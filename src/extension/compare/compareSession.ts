import {
	compareCodeSets,
	compareComponentSets,
	componentKey,
	selectVisibleEntries,
	type CodeClass,
	type CompareKind,
	type ComponentDefinition,
	type CompareEntry,
	type CompareViewOptions,
	type NamingConvention,
} from '../../core/compare/compareComponents';

/** One kind's raw snapshot: the source and target Vaults' fetched definitions, retained so a swap can invert roles without re-fetching. */
export interface CompareSnapshot<T> {
	source: T[];
	target: T[];
}

/** One side of a comparison: which saved Environment it is, plus the Vault DNS shown in the UI. */
export interface ComparePeer {
	envId: string;
	vaultDNS: string;
	label: string;
}

/**
 * The in-memory state of one Compare Environments comparison: the two peers, the full diff (the
 * snapshot the diff editor and apply act on), the view-level filter/search/show-identical state, and
 * whether apply is enabled for this comparison. Holds no `vscode` types so it stays a plain state
 * object the tree and content providers read from and unit tests can drive directly. Mutating the
 * view or the apply-enabled flag fires {@link onDidChange}; the controller's single subscription
 * repaints the tree and syncs the vscode context keys, so callers never refresh by hand.
 * Re-running the command replaces the whole session, discarding the previous snapshot — apply is
 * disabled by construction, so a new comparison always starts locked.
 */
export class CompareSession {
	readonly source: ComparePeer;
	readonly target: ComparePeer;
	/** Whether the target was a Production Vault when the comparison loaded (UI gate; re-checked at apply). */
	readonly targetIsProduction: boolean;
	/**
	 * The raw MDL snapshot both Vaults were fetched into, or `undefined` when Components (MDL) was not
	 * selected for this comparison. Retained so a swap can invert roles without re-fetching.
	 */
	readonly mdl: CompareSnapshot<ComponentDefinition> | undefined;
	/**
	 * The raw code snapshot both Vaults were fetched into, or `undefined` when Code (Vault Java SDK) was
	 * not selected for this comparison. Retained so a swap can invert roles without re-fetching.
	 */
	readonly code: CompareSnapshot<CodeClass> | undefined;
	/** When this comparison was fetched — shown next to the tree view title. */
	readonly generatedAt: Date;

	private view: CompareViewOptions = { showIdentical: false, convention: 'all', search: '', selectedOnly: false, selectedKeys: new Set<string>() };
	private applyEnabledState = false;
	private checkedKeys = new Set<string>();
	private entries: CompareEntry[];
	private byKey = new Map<string, CompareEntry>();
	private readonly listeners = new Set<() => void>();

	constructor(args: {
		source: ComparePeer;
		target: ComparePeer;
		targetIsProduction: boolean;
		mdl?: CompareSnapshot<ComponentDefinition>;
		code?: CompareSnapshot<CodeClass>;
	}) {
		this.source = args.source;
		this.target = args.target;
		this.targetIsProduction = args.targetIsProduction;
		this.mdl = args.mdl;
		this.code = args.code;
		this.generatedAt = new Date();
		this.entries = [
			...(args.mdl ? compareComponentSets(args.mdl.source, args.mdl.target) : []),
			...(args.code ? compareCodeSets(args.code.source, args.code.target) : []),
		];
		this.reindex();
	}

	/** Whether Components (MDL) was fetched for this comparison — gates the MDL top-level node. */
	get fetchedMdl(): boolean {
		return this.mdl !== undefined;
	}

	/** Whether Code (Vault Java SDK) was fetched for this comparison — gates the Code top-level node. */
	get fetchedCode(): boolean {
		return this.code !== undefined;
	}

	private reindex(): void {
		this.byKey = new Map(this.entries.map((entry) => [componentKey(entry.type, entry.name), entry]));
	}

	/**
	 * Subscribe to view/apply-enabled changes; returns an unsubscribe. Uses the repo's plain-listener
	 * convention (see `ApiHistoryStore`) so the session stays vscode-free. Entry mutations
	 * ({@link replaceEntry}/{@link removeEntry}) are deliberately silent — they only run during a
	 * post-apply recompute, which drives its own tree and diff refresh.
	 */
	onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	get showIdentical(): boolean {
		return this.view.showIdentical;
	}

	get convention(): NamingConvention {
		return this.view.convention;
	}

	get search(): string {
		return this.view.search;
	}

	/** Whether the name search is narrowing the tree — drives the title button's active icon. */
	get searchActive(): boolean {
		return this.view.search.length > 0;
	}

	/** Whether the convention filter is narrowing the tree (anything but `all`) — drives its active icon. */
	get filterActive(): boolean {
		return this.view.convention !== 'all';
	}

	/** Whether the selected-only filter is active — drives the toolbar button's `when` clause. */
	get selectedFilterActive(): boolean {
		return this.view.selectedOnly ?? false;
	}

	/** Whether apply is enabled for this comparison. Always `false` on a Production target. */
	get applyEnabled(): boolean {
		return this.applyEnabledState;
	}

	toggleIdentical(): void {
		this.view = { ...this.view, showIdentical: !this.view.showIdentical };
		this.emit();
	}

	toggleSelectedOnly(): void {
		const next = !this.view.selectedOnly;
		this.view = { ...this.view, selectedOnly: next, selectedKeys: next ? new Set(this.checkedKeys) : new Set() };
		this.emit();
	}

	setConvention(convention: NamingConvention): void {
		if (convention === this.view.convention) {
			return;
		}
		this.view = { ...this.view, convention };
		this.emit();
	}

	setSearch(search: string): void {
		if (search === this.view.search) {
			return;
		}
		this.view = { ...this.view, search };
		this.emit();
	}

	/** Set the checked state of one entry; fires change so the toolbar button and tree repaint. */
	setChecked(entry: CompareEntry, checked: boolean): void {
		const key = componentKey(entry.type, entry.name);
		const was = this.checkedKeys.has(key);
		if (checked) {
			this.checkedKeys.add(key);
		} else {
			this.checkedKeys.delete(key);
		}
		if (was !== checked) {
			this.emit();
		}
	}

	isChecked(entry: CompareEntry): boolean {
		return this.checkedKeys.has(componentKey(entry.type, entry.name));
	}

	/** All currently-checked entries (may include entries that since became non-applicable). */
	checkedEntries(): CompareEntry[] {
		return this.entries.filter((entry) => this.checkedKeys.has(componentKey(entry.type, entry.name)));
	}

	/** How many entries are currently checked — gates the "Apply Selected" toolbar button. */
	get selectionCount(): number {
		return this.checkedKeys.size;
	}

	/**
	 * Enable or disable apply for this comparison. Enabling on a Production target is refused (coerced
	 * to `false`) — the same guard the apply path enforces — so the getter always reports the honest
	 * state and the tree checkbox self-corrects on repaint. No-op changes don't fire.
	 */
	setApplyEnabled(enabled: boolean): void {
		const next = enabled && !this.targetIsProduction;
		if (next === this.applyEnabledState) {
			return;
		}
		this.applyEnabledState = next;
		this.emit();
	}

	/** The entries the tree should show, after applying the current view options. */
	visibleEntries(): CompareEntry[] {
		return selectVisibleEntries(this.entries, this.view);
	}

	/** The visible entries of one kind — the MDL node and the Code node each render their own slice. */
	visibleEntriesOfKind(kind: CompareKind): CompareEntry[] {
		return this.visibleEntries().filter((entry) => entry.kind === kind);
	}

	/** Total entries of one kind, before view filtering — distinguishes "found nothing" from "all identical". */
	entryCountOfKind(kind: CompareKind): number {
		return this.entries.filter((entry) => entry.kind === kind).length;
	}

	/** How many entries differ (anything but Identical) — drives the explicit "no differences" state. */
	get differenceCount(): number {
		return this.entries.filter((entry) => entry.status !== 'identical').length;
	}

	/**
	 * How many entries are **applicable** — a create/update or delete apply could act on them. That is
	 * any status but `identical` (nothing to push) and `unavailable` (a code class whose source couldn't
	 * be read, so it can't be deployed or classified). The apply header is gated on this rather than
	 * {@link differenceCount}: a comparison whose only differences are unavailable code classes offers no
	 * apply control, since none of them can be acted on. Spans both kinds — MDL and code apply alike.
	 */
	get applicableDifferenceCount(): number {
		return this.entries.filter(
			(entry) => entry.status !== 'identical' && entry.status !== 'unavailable',
		).length;
	}

	getEntry(type: string, name: string): CompareEntry | undefined {
		return this.byKey.get(componentKey(type, name));
	}

	/** Replace an entry in place (after a recompute), keeping list order stable. */
	replaceEntry(entry: CompareEntry): void {
		const key = componentKey(entry.type, entry.name);
		const index = this.entries.findIndex(
			(candidate) => componentKey(candidate.type, candidate.name) === key,
		);
		if (index >= 0) {
			this.entries[index] = entry;
		} else {
			this.entries.push(entry);
		}
		this.byKey.set(key, entry);
		if (entry.status === 'identical' || entry.status === 'unavailable') {
			this.checkedKeys.delete(key);
		}
	}

	/** Drop an entry entirely (a target-only component that was just deleted exists on neither side). */
	removeEntry(type: string, name: string): void {
		const key = componentKey(type, name);
		this.entries = this.entries.filter(
			(candidate) => componentKey(candidate.type, candidate.name) !== key,
		);
		this.byKey.delete(key);
		this.checkedKeys.delete(key);
	}
}
