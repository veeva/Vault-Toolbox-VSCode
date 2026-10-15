import * as vscode from 'vscode';
import { isProductionVault } from '../../core/production';
import type { Environment } from '../../core/models/environment';
import type { ConnectionState, ObservableConnection } from '../connection/types';
import type { EnvironmentService } from '../environments/environmentService';

/** The status-bar icon codicon for non-Production environments. */
const STATUS_ICON = 'device-desktop';

/** The icon shown briefly in place of {@link STATUS_ICON} when the active environment switches. */
const SWITCH_FLASH_ICON = 'check';

/** The color the icon/label are tinted while the switch flash is showing. */
const SWITCH_FLASH_COLOR = new vscode.ThemeColor('charts.green');

/** Left-aligned status-bar slot priority; higher sits further left within the left group. */
const STATUS_BAR_PRIORITY = 100;

/** How long the switch flash (icon + color) lasts when the active environment switches. */
const SWITCH_FLASH_MS = 2000;

/**
 * Always-visible status-bar entry point for Vault Toolbox: shows the active environment's label
 * and flags a connected Production Vault with a "(PROD)" suffix, or a neutral "Vault Toolbox"
 * label whenever there's no active environment or no live connection — including while a connect
 * attempt is in flight or has failed. The label only ever names a Vault once it's actually
 * connected; a pending or failed connect (e.g. an expired session on startup auto-connect) must
 * never claim a name it hasn't earned. The tooltip may still name the target environment and
 * explain what's happening (connecting/failed) even while the label stays neutral. Clicking
 * reveals the Environments tab, expanding the active environment's Vault info section if it's
 * connected.
 * Re-renders on active-pointer and connection changes. `connection` is scoped to the active
 * environment only (see ADR 0004) — other environments may be connected in the background, but the
 * status bar only ever reflects the one you're currently acting on.
 */
export class EnvironmentStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly subscriptions: Array<() => void> = [];
	/**
	 * The last environment rendered as connected, so a later connect to a different one can be
	 * flashed as a switch. Deliberately sticky across intervening disconnected/connecting renders —
	 * e.g. the active pointer moves to the new (not-yet-connected) environment before its connection
	 * resolves — so that in-between state doesn't erase the "previous" memory before the switch lands.
	 */
	private lastConnectedEnvId: string | undefined;
	/** Set while the switch flash is showing; its mere presence is what `renderConnected` checks, so
	 * a redundant re-render mid-flash (see the constructor's subscriptions) repaints the same flash
	 * instead of clearing it early. */
	private flashTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly service: EnvironmentService,
		private readonly connection: ObservableConnection,
	) {
		this.item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			STATUS_BAR_PRIORITY,
		);
		this.item.command = 'vaultToolbox.revealActiveEnvironment';
		this.subscriptions.push(
			this.service.onDidChange(() => this.render()),
			this.connection.onDidChangeState(() => this.render()),
		);
		this.render();
	}

	private render(): void {
		const activeId = this.service.getActiveId();
		const env = activeId ? this.service.get(activeId) : undefined;
		const state = this.connection.getState();

		if (env && state.status === 'connected') {
			const isSwitch = this.lastConnectedEnvId !== undefined && this.lastConnectedEnvId !== env.id;
			if (isSwitch) {
				this.startSwitchFlash();
			}
			this.renderConnected(env, state);
			this.lastConnectedEnvId = env.id;
			return;
		}

		this.renderNotConnected(env, state);
	}

	/** Starts (or restarts) the switch flash window; `renderConnected` reads `flashTimer`'s presence
	 * to decide whether to paint the flashed icon/color, so this must run before it. */
	private startSwitchFlash(): void {
		if (this.flashTimer) {
			clearTimeout(this.flashTimer);
		}
		this.flashTimer = setTimeout(() => {
			this.flashTimer = undefined;
			this.render();
		}, SWITCH_FLASH_MS);
	}

	/** Neutral label for every state that hasn't produced a live connection yet — disconnected,
	 * connecting, or a failed attempt. The label never names a Vault it isn't actually connected
	 * to; the tooltip may still name the target environment and explain what's happening. */
	private renderNotConnected(env: Environment | undefined, state: ConnectionState): void {
		this.item.text = `$(${STATUS_ICON}) Vault Toolbox`;
		this.item.tooltip = this.notConnectedTooltip(env, state);
		this.item.color = undefined;
		this.item.backgroundColor = undefined;
		this.item.show();
	}

	private notConnectedTooltip(env: Environment | undefined, state: ConnectionState): string {
		if (!env || state.status === 'disconnected') {
			return 'Open Vault Toolbox';
		}
		if (state.status === 'connecting') {
			return `Connecting to ${env.label} (${env.vaultDNS})…`;
		}
		return `${env.label} (${env.vaultDNS})\nConnection failed: ${state.error ?? 'Unknown error'}`;
	}

	private renderConnected(env: Environment, state: ConnectionState): void {
		const isProduction =
			!!state.info && isProductionVault(state.info.domain?.domainType, state.info.environment.vaultDNS);
		const suffix = isProduction ? ' (PROD)' : '';
		const isFlashing = !!this.flashTimer;
		const icon = isFlashing ? SWITCH_FLASH_ICON : STATUS_ICON;
		this.item.text = `$(${icon}) ${env.label}${suffix}`;
		this.item.tooltip = `Vault Toolbox — active environment\n${env.label} (${env.vaultDNS})\nStatus: connected${
			isProduction ? '\n⚠ PROD Vault' : ''
		}`;
		this.item.backgroundColor = undefined;
		this.item.color = isFlashing ? SWITCH_FLASH_COLOR : undefined;
		this.item.show();
	}

	dispose(): void {
		if (this.flashTimer) {
			clearTimeout(this.flashTimer);
		}
		for (const unsub of this.subscriptions) {
			unsub();
		}
		this.item.dispose();
	}
}
