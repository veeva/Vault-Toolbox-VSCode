import * as vscode from 'vscode';
import type { HostToShellMessage, ShellTab } from '../../shared/shellProtocol';
import { createShellHost, type ShellDeps, type ShellHost } from './shellHost';
import type { ShellSurfaceRegistry } from './shellSurfaceRegistry';
import { renderVqlHtml, vqlLocalResourceRoots } from './vqlWebviewHost';

export const SHELL_VIEW_ID = 'vaultToolbox.shell';

/**
 * The single sidebar view: the unified tab shell (Environments + VQL). Always visible in the Vault
 * Toolbox Activity Bar container — no more context-key view swapping. Palette commands that need the
 * UI ({@link revealTab}) focus this view and navigate the shell to a tab/screen, buffering the intent
 * until the webview signals it has mounted so a first-open navigation isn't dropped.
 */
export class ShellViewProvider implements vscode.WebviewViewProvider {
	private readonly extensionUri: vscode.Uri;
	private host?: ShellHost;
	private ready = false;
	private pendingNavigate?: HostToShellMessage;
	private view?: vscode.WebviewView;

	constructor(
		context: vscode.ExtensionContext,
		private readonly deps: ShellDeps,
		private readonly surfaces: ShellSurfaceRegistry,
	) {
		this.extensionUri = context.extensionUri;
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: vqlLocalResourceRoots(this.extensionUri),
		};
		this.ready = false;
		const host = createShellHost(view.webview, this.deps, 'sidebar', () => this.onReady());
		this.host = host;
		this.surfaces.registerSidebar(host);
		view.webview.html = renderVqlHtml({
			webview: view.webview,
			extensionUri: this.extensionUri,
			surface: 'sidebar',
		});
		const receive = view.webview.onDidReceiveMessage((message) => host.handle(message));
		view.onDidDispose(() => {
			receive.dispose();
			host.dispose();
			this.surfaces.unregisterSidebar(host);
			if (this.host === host) {
				this.host = undefined;
				this.ready = false;
			}
			if (this.view === view) {
				this.view = undefined;
			}
		});
	}

	/** Focus the shell view and navigate it to a tab (optionally opening the Environments add sub-screen). */
	async revealTab(tab: ShellTab, screen?: 'add'): Promise<void> {
		const navigate: HostToShellMessage = { type: 'navigate', tab, screen };
		await vscode.commands.executeCommand(`${SHELL_VIEW_ID}.focus`);
		if (this.host && this.ready) {
			this.host.postShell(navigate);
		} else {
			this.pendingNavigate = navigate;
		}
	}

	/**
	 * Reveal the shell reliably even if its lone view was relocated out of the Vault Toolbox
	 * container and that location was closed — which drops the container's Activity Bar icon.
	 * If the view is already visible somewhere, just focus it; otherwise reset it to its home
	 * container first (restoring the icon) before focusing.
	 */
	async open(): Promise<void> {
		if (this.view?.visible) {
			await vscode.commands.executeCommand(`${SHELL_VIEW_ID}.focus`);
			return;
		}
		await vscode.commands.executeCommand(`${SHELL_VIEW_ID}.resetViewLocation`);
		await vscode.commands.executeCommand(`${SHELL_VIEW_ID}.focus`);
	}

	private onReady(): void {
		this.ready = true;
		if (this.pendingNavigate && this.host) {
			this.host.postShell(this.pendingNavigate);
			this.pendingNavigate = undefined;
		}
	}
}
