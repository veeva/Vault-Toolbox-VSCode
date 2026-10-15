import * as vscode from 'vscode';
import type { CompareEntry, CompareStatus } from '../../core/compare/compareComponents';
import { simpleClassName } from '../../core/sdk/sdkExtraction';
import type { CompareSession } from './compareSession';

/** The command an entry row runs when selected — opens the native source-vs-target diff. */
export const OPEN_DIFF_COMMAND = 'vaultToolbox.compareOpenDiff';

/**
 * A node in the Vault Compare tree. When both kinds were fetched, a top-level `kindRoot` node separates
 * them — **Components (MDL)** (expanding to component-type groups, then entry rows) and **Code (Vault
 * Java SDK)** (expanding to a Java `package` tree, then entry rows); a single-kind comparison skips the
 * wrapper and puts that kind's groups at the root. A `message` node stands in for the explicit "no
 * differences" / "nothing found" state so a node never silently vanishes.
 */
export type CompareNode =
	| { kind: 'kindRoot'; compareKind: 'mdl' | 'code' }
	| { kind: 'type'; type: string }
	| { kind: 'package'; segments: string[] }
	| { kind: 'entry'; entry: CompareEntry }
	| { kind: 'message'; text: string };

/** Per-status presentation: the badge shown as the row description and its themed icon. */
const STATUS_PRESENTATION: Record<CompareStatus, { badge: string; icon: string; color?: string }> =
	{
		'source-only': { badge: 'Source Only', icon: 'diff-added', color: 'gitDecoration.addedResourceForeground' },
		'target-only': { badge: 'Target Only', icon: 'diff-removed', color: 'gitDecoration.deletedResourceForeground' },
		modified: { badge: 'Modified', icon: 'diff-modified', color: 'gitDecoration.modifiedResourceForeground' },
		identical: { badge: 'Identical', icon: 'check', color: 'disabledForeground' },
		unavailable: { badge: 'Unavailable', icon: 'warning', color: 'problemsWarningIcon.foreground' },
	};

/** The display label for a top-level kind node. */
const KIND_LABEL: Record<'mdl' | 'code', string> = {
	mdl: 'Components (MDL)',
	code: 'Code (Vault Java SDK)',
};

/**
 * The `viewItem` context value a row carries, so menus can be gated by status and selection state.
 * `source-only`/`modified` are `applicable`; `target-only` is `deletable`; `identical`/`unavailable`
 * offer no apply. When an applicable/deletable row is checked, `.checked` is appended so the context
 * menu can swap "Apply to Target" for "Apply Selected to Target".
 */
function entryContextValue(status: CompareStatus, checked: boolean): string {
	switch (status) {
		case 'target-only':
			return checked ? 'compareEntry.deletable.checked' : 'compareEntry.deletable';
		case 'identical':
			return 'compareEntry.identical';
		case 'unavailable':
			return 'compareEntry.unavailable';
		default:
			return checked ? 'compareEntry.applicable.checked' : 'compareEntry.applicable';
	}
}

/**
 * Renders a {@link CompareSession}'s visible entries as a native TreeView. When both kinds were fetched
 * the comparison splits into two top-level nodes — Components (MDL) grouped by component type, and Code
 * (Vault Java SDK) grouped as a Java package tree; a single-kind comparison drops the wrapper and shows
 * that kind's groups at the root (an MDL-only comparison is unchanged from before code compare). Reads
 * the session on demand through `getSession` and re-reads on every `refresh()`, so a re-run comparison, a
 * view-option change, or a post-apply recompute all flow through one signal. A fetched-but-empty kind
 * shows an explicit message node rather than disappearing.
 */
export class CompareTreeProvider implements vscode.TreeDataProvider<CompareNode> {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

	constructor(private readonly getSession: () => CompareSession | undefined) {}

	/** Re-read the session and repaint the whole tree. */
	refresh(): void {
		this.onDidChangeEmitter.fire();
	}

	getTreeItem(node: CompareNode): vscode.TreeItem {
		if (node.kind === 'message') {
			const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
			item.contextValue = 'compareMessage';
			return item;
		}
		if (node.kind === 'kindRoot') {
			const item = new vscode.TreeItem(KIND_LABEL[node.compareKind], vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = `compareKindRoot.${node.compareKind}`;
			return item;
		}
		if (node.kind === 'type') {
			const item = new vscode.TreeItem(node.type, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = 'compareType';
			return item;
		}
		if (node.kind === 'package') {
			const label = node.segments[node.segments.length - 1];
			const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = 'comparePackage';
			return item;
		}
		return this.entryItem(node.entry);
	}

	getChildren(node?: CompareNode): CompareNode[] {
		const session = this.getSession();
		if (!session) {
			return [];
		}
		if (!node) {
			return this.rootNodes(session);
		}
		if (node.kind === 'kindRoot') {
			return node.compareKind === 'mdl' ? this.mdlChildren(session) : this.codeChildren(session, []);
		}
		if (node.kind === 'type') {
			return session
				.visibleEntriesOfKind('mdl')
				.filter((entry) => entry.type === node.type)
				.map((entry) => ({ kind: 'entry', entry }));
		}
		if (node.kind === 'package') {
			return this.codeChildren(session, node.segments);
		}
		return [];
	}

	/**
	 * The top-level rows. The kind wrapper nodes exist only to **separate** MDL from code when both were
	 * fetched; a single-kind comparison renders that kind's content directly at the root — so an MDL-only
	 * comparison looks exactly as it did before code compare (component-type groups at the root, no
	 * wrapper), and a code-only comparison is a bare package tree. The apply header is always pinned first.
	 */
	private rootNodes(session: CompareSession): CompareNode[] {
		const header = this.applyHeader(session);
		if (session.fetchedMdl && session.fetchedCode) {
			return [
				...header,
				{ kind: 'kindRoot', compareKind: 'mdl' },
				{ kind: 'kindRoot', compareKind: 'code' },
			];
		}
		if (session.fetchedMdl) {
			return [...header, ...this.mdlChildren(session)];
		}
		return [...header, ...this.codeChildren(session, [])];
	}

	/** The MDL node's children: one group node per component type present in the visible MDL entries. */
	private mdlChildren(session: CompareSession): CompareNode[] {
		const visible = session.visibleEntriesOfKind('mdl');
		if (visible.length === 0) {
			return [{ kind: 'message', text: this.mdlEmptyMessage(session) }];
		}
		const types: string[] = [];
		const seen = new Set<string>();
		for (const entry of visible) {
			if (!seen.has(entry.type)) {
				seen.add(entry.type);
				types.push(entry.type);
			}
		}
		return types.map((type): CompareNode => ({ kind: 'type', type }));
	}

	/**
	 * The children under a package path in the Code node: the next-level sub-packages, then the class
	 * rows whose package is exactly this level. A code entry's `name` is its fully-qualified class name;
	 * splitting on `.` yields the package segments plus the simple class name at the end. At the Code
	 * root (`prefix` empty) this returns the top-level package(s) — e.g. `com`.
	 */
	private codeChildren(session: CompareSession, prefix: string[]): CompareNode[] {
		const visible = session.visibleEntriesOfKind('code');
		if (prefix.length === 0 && visible.length === 0) {
			return [{ kind: 'message', text: this.codeEmptyMessage(session) }];
		}
		const depth = prefix.length;
		const packages = new Set<string>();
		const leaves: CompareEntry[] = [];
		for (const entry of visible) {
			const segments = entry.name.split('.');
			if (!prefixMatches(segments, prefix)) {
				continue;
			}
			if (segments.length === depth + 1) {
				leaves.push(entry);
			} else if (segments.length > depth + 1) {
				packages.add(segments[depth]);
			}
		}
		const packageNodes = [...packages]
			.sort((a, b) => a.localeCompare(b))
			.map((segment): CompareNode => ({ kind: 'package', segments: [...prefix, segment] }));
		const leafNodes = leaves
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((entry): CompareNode => ({ kind: 'entry', entry }));
		return [...packageNodes, ...leafNodes];
	}

	/**
	 * The pinned top row when the target is Production: an explanatory message. Shown only when there are
	 * applicable differences so it doesn't appear on an identical comparison. The apply-enable checkbox
	 * lives in the Compare Environments webview tab (not the native tree).
	 */
	private applyHeader(session: CompareSession): CompareNode[] {
		if (session.applicableDifferenceCount === 0 || !session.targetIsProduction) {
			return [];
		}
		return [
			{
				kind: 'message',
				text: `Apply disabled — ${session.target.vaultDNS} is a Production Vault.`,
			},
		];
	}

	/** The message shown under the MDL node when nothing is visible — "found nothing" vs "filtered" vs "match". */
	private mdlEmptyMessage(session: CompareSession): string {
		if (session.entryCountOfKind('mdl') === 0) {
			return 'No MDL components found.';
		}
		if (session.selectedFilterActive) {
			return 'No selections.';
		}
		if (session.searchActive || session.filterActive) {
			return 'No components match the current filter.';
		}
		return 'No differences — the two Vaults match.';
	}

	/** The message shown under the Code node when nothing is visible — "found nothing" vs "filtered" vs "match". */
	private codeEmptyMessage(session: CompareSession): string {
		if (session.entryCountOfKind('code') === 0) {
			return 'No custom Java SDK code found.';
		}
		if (session.selectedFilterActive) {
			return 'No selections.';
		}
		if (session.searchActive) {
			return 'No classes match the current search.';
		}
		return 'No differences — the two Vaults match.';
	}

	private entryItem(entry: CompareEntry): vscode.TreeItem {
		const session = this.getSession();
		const checked = session?.isChecked(entry) ?? false;
		const presentation = STATUS_PRESENTATION[entry.status];
		const label = entry.kind === 'code' ? simpleClassName(entry.name) : entry.name;
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.description = presentation.badge;
		item.iconPath = new vscode.ThemeIcon(
			presentation.icon,
			presentation.color ? new vscode.ThemeColor(presentation.color) : undefined,
		);
		item.contextValue = entryContextValue(entry.status, checked);
		item.tooltip =
			entry.kind === 'code'
				? `${entry.name} — ${presentation.badge}`
				: `${entry.type} ${entry.name} — ${presentation.badge}`;
		item.command = {
			command: OPEN_DIFF_COMMAND,
			title: 'Open Diff',
			arguments: [{ kind: 'entry', entry } satisfies CompareNode],
		};
		const isApplicable = entry.status !== 'identical' && entry.status !== 'unavailable';
		if (isApplicable && session?.applyEnabled) {
			item.checkboxState = checked
				? vscode.TreeItemCheckboxState.Checked
				: vscode.TreeItemCheckboxState.Unchecked;
		}
		return item;
	}
}

/** Whether `segments` begins with every element of `prefix` (a class sitting under that package path). */
function prefixMatches(segments: string[], prefix: string[]): boolean {
	if (segments.length <= prefix.length) {
		return false;
	}
	return prefix.every((part, index) => segments[index] === part);
}
