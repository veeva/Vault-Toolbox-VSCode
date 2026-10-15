import * as vscode from 'vscode';
import type { PopOutTab } from '../../shared/shellProtocol';
import { createShellHost, type ShellDeps, type ShellHost } from './shellHost';
import type { ShellSurfaceRegistry } from './shellSurfaceRegistry';
import { renderVqlHtml, vqlLocalResourceRoots } from './vqlWebviewHost';

interface PopOutTabConfig {
	/** Distinct webview-panel view type so each poppable tab gets its own editor-area tab. */
	viewType: string;
	title: string;
	/** Fires `true` when this tab's panel opens and `false` when it closes. */
	openEmitter: vscode.EventEmitter<boolean>;
}

const POP_OUT_TABS: Record<PopOutTab, PopOutTabConfig> = {
	vql: {
		viewType: 'vaultToolbox.vqlEditorPanel',
		title: 'VQL Editor',
		openEmitter: new vscode.EventEmitter<boolean>(),
	},
	apiHistory: {
		viewType: 'vaultToolbox.apiHistoryPanel',
		title: 'API History',
		openEmitter: new vscode.EventEmitter<boolean>(),
	},
};

/**
 * Host side of a popped-out shell tab — an editor-area `WebviewPanel` (revealed if already open),
 * rendered in the `panel` surface filtered to the single tab it hosts. One singleton panel per
 * poppable tab, so popping out VQL and API History yields two independent editor tabs and neither
 * disturbs the other. The CSP/HTML shell, bus construction, and routing are shared with the sidebar
 * via {@link createShellHost}. Each panel registers as the active surface for its tab (so LLM-run
 * queries / API History reveals land there) and broadcasts its open/closed state so the sidebar's
 * matching tab can show a placeholder while the view lives here.
 */
export interface ShellPanelShowOptions {
	context: vscode.ExtensionContext;
	deps: ShellDeps;
	surfaces: ShellSurfaceRegistry;
	tab: PopOutTab;
}

export class ShellPanel {
	private static readonly panels = new Map<PopOutTab, ShellPanel>();

	/** Fires `true` when the given tab's panel opens and `false` when it closes. */
	static onDidChangeOpen(tab: PopOutTab): vscode.Event<boolean> {
		return POP_OUT_TABS[tab].openEmitter.event;
	}

	static isOpen(tab: PopOutTab): boolean {
		return ShellPanel.panels.has(tab);
	}

	static show({ context, deps, surfaces, tab }: ShellPanelShowOptions): void {
		const existing = ShellPanel.panels.get(tab);
		if (existing) {
			existing.panel.reveal();
			return;
		}
		const config = POP_OUT_TABS[tab];
		const panel = vscode.window.createWebviewPanel(
			config.viewType,
			config.title,
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: vqlLocalResourceRoots(context.extensionUri),
			},
		);
		ShellPanel.panels.set(
			tab,
			new ShellPanel(panel, { extensionUri: context.extensionUri, tab, deps, surfaces }),
		);
		config.openEmitter.fire(true);
	}

	private readonly disposables: vscode.Disposable[] = [];
	private readonly host: ShellHost;
	private readonly surfaces: ShellSurfaceRegistry;

	private readonly tab: PopOutTab;

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		{
			extensionUri,
			tab,
			deps,
			surfaces,
		}: {
			extensionUri: vscode.Uri;
			tab: PopOutTab;
			deps: ShellDeps;
			surfaces: ShellSurfaceRegistry;
		},
	) {
		this.tab = tab;
		this.surfaces = surfaces;
		this.host = createShellHost(panel.webview, deps, 'panel');
		this.surfaces.registerPanel(this.tab, this.host);
		this.panel.webview.html = renderVqlHtml({
			webview: panel.webview,
			extensionUri,
			surface: 'panel',
			panelTab: this.tab,
		});
		this.panel.webview.onDidReceiveMessage(
			(message) => this.host.handle(message),
			undefined,
			this.disposables,
		);
		this.disposables.push({ dispose: () => this.host.dispose() });
		this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
	}

	private dispose(): void {
		ShellPanel.panels.delete(this.tab);
		this.surfaces.unregisterPanel(this.tab, this.host);
		this.panel.dispose();
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
		POP_OUT_TABS[this.tab].openEmitter.fire(false);
	}
}
