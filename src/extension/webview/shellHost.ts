import * as vscode from 'vscode';
import {
	POP_OUT_TAB_IDS,
	type Channel,
	type HostToShellMessage,
	type PopOutTab,
	type ShellEnvelope,
	type ShellSurface,
	type ShellToHostMessage,
} from '../../shared/shellProtocol';
import type { ConnectionStatePort, EnvironmentActions } from './environmentsBus';
import { EnvironmentsBus } from './environmentsBus';
import type { ActionRunner } from './actionsBus';
import { ActionsBus } from './actionsBus';
import type { CompareRunner } from './compareBus';
import { CompareBus } from './compareBus';
import { ApiHistoryBus } from './apiHistoryBus';
import type { EnvironmentService } from '../environments/environmentService';
import type { ApiHistoryStore } from '../storage/apiHistoryStore';
import type { ShellSurfaceHost } from './shellSurfaceRegistry';
import { createVqlBus, type VqlHostDeps } from './vqlWebviewHost';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../shared/vqlProtocol';

/** The popped-out panels, viewed as openable surfaces the shell can reflect and reveal. */
export interface PopOutPort {
	/** Open the given tab's panel, or reveal it if already open. */
	open(tab: PopOutTab): void;
	/** Whether the given tab's panel is open (drives that sidebar tab's popped-out placeholder). */
	isOpen(tab: PopOutTab): boolean;
	/** Fires whenever the given tab's panel opens or closes. Returns an unsubscribe. */
	onDidChangeOpen(tab: PopOutTab, listener: (open: boolean) => void): () => void;
}

/** Everything the unified shell webview needs from the host: the VQL deps + the environment layer. */
export interface ShellDeps {
	vql: VqlHostDeps;
	service: EnvironmentService;
	actions: EnvironmentActions;
	/**
	 * Per-environment connection state for the Environments tab's list — unlike `vql.connection`
	 * (scoped to the active environment only), this reports every connected environment's own
	 * status so the list can show more than one as live at once (see ADR 0004).
	 */
	connections: ConnectionStatePort;
	/** Runs an Actions-tab action by id (Vault work + native UX); the placeholder toast lives here. */
	actionRunner: ActionRunner;
	/**
	 * The host side of Compare Environments: runs a comparison for a source/target pair chosen in the
	 * compare selector, and publishes the live comparison and tree selection back to every surface.
	 */
	compareRunner: CompareRunner;
	/** In-memory log of every Vault call, surfaced by the API History tab. */
	apiHistory: ApiHistoryStore;
	popOut: PopOutPort;
}

/**
 * What a resolved shell webview exposes to its provider/panel: inbound handling, control, teardown,
 * and (as a {@link ShellSurfaceHost}) the ability to push an LLM-run query into the VQL editor and to
 * reveal a specific API History entry.
 */
export interface ShellHost extends ShellSurfaceHost {
	/** Feed one raw message from `webview.onDidReceiveMessage` into the router. */
	handle(raw: unknown): void;
	/** Push a shell-control message (e.g. navigate) to the webview. */
	postShell(message: HostToShellMessage): void;
	dispose(): void;
}

/**
 * Binds the settings action to the canonical `vaultToolbox.openSettings` command — the single
 * entry point both the gear button and the command-palette entry converge on. Takes `executeCommand`
 * as a parameter so it stays free of the `vscode` module and can be tested directly.
 */
export function openSettingsVia(executeCommand: (command: string) => unknown): () => void {
	return () => void executeCommand('vaultToolbox.openSettings');
}

type ChannelHandler = (message: unknown) => void | Promise<void>;

/**
 * Assemble the host side of a unified shell webview for a given `vscode.Webview`. Routing,
 * readiness gating, and feature bus wiring are all internal — callers interact only through
 * the three-method {@link ShellHost} interface (handle / postShell / postVql / reveal*).
 *
 * The `surface` distinguishes the always-on sidebar from the popped-out panel: only the sidebar
 * reflects the panel's open/closed state (so its VQL tab can show a placeholder while the editor
 * lives in the panel).
 */
export function createShellHost(
	webview: vscode.Webview,
	deps: ShellDeps,
	surface: ShellSurface,
	onReady?: () => void,
): ShellHost {
	const { connection } = deps.vql;
	const postEnvelope = (envelope: ShellEnvelope): void => void webview.postMessage(envelope);
	const postShell = (message: HostToShellMessage): void =>
		postEnvelope({ channel: 'shell', message });
	const poster = (channel: Channel): ((message: unknown) => void) =>
		(message) => postEnvelope({ channel, message });

	// Handlers table read lazily at dispatch time, so each bus can be constructed with its
	// channel-scoped poster before its handler slot is populated.
	const handlers: Partial<Record<Channel, ChannelHandler>> = {};

	// Unified per-channel readiness gate: each channel's bus calls onReady() once, after which
	// any calls buffered through whenReady() are flushed and future calls go through immediately.
	const channelReady = new Set<Channel>();
	const pendingFns = new Map<Channel, Array<() => void>>();
	function markReady(channel: Channel): void {
		channelReady.add(channel);
		const fns = pendingFns.get(channel) ?? [];
		pendingFns.delete(channel);
		fns.forEach((fn) => fn());
	}
	function whenReady(channel: Channel, fn: () => void): void {
		if (channelReady.has(channel)) {
			fn();
		} else {
			if (!pendingFns.has(channel)) pendingFns.set(channel, []);
			pendingFns.get(channel)!.push(fn);
		}
	}

	const postVqlRaw = poster('vql');
	const vqlBus = createVqlBus(postVqlRaw, deps.vql);
	handlers.vql = (message) => {
		if ((message as WebviewToHostMessage | null)?.type === 'ready') markReady('vql');
		return vqlBus.handle(message);
	};
	const postVql = (message: HostToWebviewMessage): void => whenReady('vql', () => postVqlRaw(message));

	const environmentsBus = new EnvironmentsBus({
		environments: {
			list: () => deps.service.list(),
			getActiveId: () => deps.service.getActiveId(),
		},
		connection: deps.connections,
		actions: deps.actions,
		post: poster('environments'),
		onReady: () => markReady('environments'),
	});
	handlers.environments = (message) => environmentsBus.handle(message);

	const actionsBus = new ActionsBus({ runner: deps.actionRunner, post: poster('actions') });
	handlers.actions = (message) => actionsBus.handle(message);

	// Bidirectional: the webview sends a start/cancel request; the host posts the compare result back so
	// the selector can show a loading state and surface failures inline. Compare-tree selection pushes are
	// *subscribed* to below rather than registered on the runner, so every live surface gets them — an
	// assignable poster would leave whichever webview was created last as the only one still listening.
	const postCompare = poster('compareEnvironments');
	const compareBus = new CompareBus({
		runner: deps.compareRunner,
		post: postCompare,
	});
	handlers.compareEnvironments = (message) => compareBus.handle(message);

	// Bidirectional: the webview requests a snapshot / clear; the host pushes each newly recorded call.
	const apiHistoryBus = new ApiHistoryBus({
		store: deps.apiHistory,
		post: poster('apiHistory'),
		onReady: () => markReady('apiHistory'),
	});
	handlers.apiHistory = (message) => apiHistoryBus.handle(message);

	const openSettings = openSettingsVia(vscode.commands.executeCommand.bind(vscode.commands));
	handlers.shell = (raw): void => {
		if (!isShellToHostMessage(raw)) return;
		if (raw.type === 'popOut') {
			deps.popOut.open(raw.tab);
		} else if (raw.type === 'ready' && surface === 'sidebar') {
			for (const tab of POP_OUT_TAB_IDS) {
				postShell({ type: 'poppedOut', tab, value: deps.popOut.isOpen(tab) });
			}
			onReady?.();
		} else if (raw.type === 'openSettings') {
			openSettings();
		}
	};

	const logDirectorySub = vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('vaultToolbox.ConfigReportDirectory')) {
			actionsBus.pushConfigReportLocation();
		}
		if (event.affectsConfiguration('vaultToolbox.DeveloperLogsDirectory')) {
			actionsBus.pushApiUsageLogLocation();
			actionsBus.pushSdkRuntimeLogLocation();
		}
	});
	const subscriptions = [
		connection.onDidChangeState(() => {
			vqlBus.pushConnectionState();
			environmentsBus.pushSnapshot();
			// The preview paths embed the connected Vault id, so refresh them when the connection changes.
			actionsBus.pushConfigReportLocation();
			actionsBus.pushApiUsageLogLocation();
			actionsBus.pushSdkRuntimeLogLocation();
		}),
		() => logDirectorySub.dispose(),
		// Kept deliberately, though connection.onDidChangeState above already fires on env-store changes
		// (ActiveConnection forwards them): this keeps the environments-list refresh explicitly tied to
		// env-store changes rather than load-bearing on that forwarding. Removing it would make a plain
		// env rename silently stop refreshing the list if ActiveConnection ever deduped pure-store
		// events. The extra push on a store change is idempotent — the webview re-renders identically.
		deps.service.onDidChange(() => environmentsBus.pushSnapshot()),
		deps.apiHistory.onDidAdd((entry) => apiHistoryBus.pushEntry(entry)),
		deps.apiHistory.onDidClear(() => apiHistoryBus.pushCleared()),
		deps.compareRunner.onSelectionChanged((hasSelection) =>
			postCompare({ type: 'selectionChanged', hasSelection }),
		),
		deps.compareRunner.onSessionStateChanged((session) => postCompare({ type: 'sessionState', session })),
	];
	if (surface === 'sidebar') {
		for (const tab of POP_OUT_TAB_IDS) {
			subscriptions.push(
				deps.popOut.onDidChangeOpen(tab, (open) =>
					postShell({ type: 'poppedOut', tab, value: open }),
				),
			);
		}
	}

	return {
		handle: (raw) => void dispatch(raw, handlers),
		postShell,
		postVql,
		revealApiHistoryEntry: (id) => whenReady('apiHistory', () => apiHistoryBus.pushReveal(id)),
		revealEnvironmentInfo: () => whenReady('environments', () => environmentsBus.pushReveal()),
		dispose: () => subscriptions.forEach((unsubscribe) => unsubscribe()),
	};
}

/** Unwrap a channel envelope and dispatch its inner message to the matching handler. */
async function dispatch(
	raw: unknown,
	handlers: Partial<Record<Channel, ChannelHandler>>,
): Promise<void> {
	if (!isEnvelope(raw)) {
		// Drop malformed/untrusted input: the compile-time envelope shape is not enforced at runtime,
		// and a buggy or compromised webview must not flow junk into a feature bus.
		return;
	}
	await handlers[raw.channel]?.(raw.message);
}

/** True when `raw` is a valid shell-channel message from the webview. */
function isShellToHostMessage(raw: unknown): raw is ShellToHostMessage {
	if (typeof raw !== 'object' || raw === null) return false;
	const { type } = raw as Record<string, unknown>;
	return type === 'ready' || type === 'openSettings' || type === 'popOut';
}

/** True when `raw` has the `{ channel, message }` envelope shape with a known channel. */
function isEnvelope(raw: unknown): raw is ShellEnvelope {
	if (typeof raw !== 'object' || raw === null || !('channel' in raw) || !('message' in raw)) {
		return false;
	}
	const { channel } = raw as { channel: unknown };
	return (
		channel === 'vql' ||
		channel === 'environments' ||
		channel === 'shell' ||
		channel === 'actions' ||
		channel === 'apiHistory' ||
		channel === 'compareEnvironments'
	);
}
