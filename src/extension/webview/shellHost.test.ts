import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';

// shellHost imports vscode for command dispatch; stub it so the module loads in node test env.
vi.mock('vscode', () => ({
	commands: { executeCommand: vi.fn() },
	window: { showInputBox: vi.fn() },
	env: { clipboard: { readText: vi.fn() } },
	workspace: { onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })) },
}));

import { openSettingsVia, createShellHost, type ShellDeps } from './shellHost';
import { CompareStateBroadcast } from '../compare/compareStateBroadcast';
import type { CompareSessionState } from '../../shared/compareProtocol';

const noop = () => () => {};

type SessionBroadcast = CompareStateBroadcast<CompareSessionState | undefined>;

function makeDeps(
	compareSelection = new CompareStateBroadcast(false),
	compareSession: SessionBroadcast = new CompareStateBroadcast<CompareSessionState | undefined>(undefined),
): ShellDeps {
	return {
		vql: {
			connection: {
				onDidChangeState: noop,
				getState: () => ({ status: 'disconnected' as const }),
				run: vi.fn(),
			},
			history: { list: () => [], add: vi.fn(), clear: vi.fn() },
			metadata: {
				getTargets: vi.fn(),
				getFields: vi.fn(),
				getRelationships: vi.fn(),
				getPicklistFields: vi.fn(),
				getPicklistValues: vi.fn(),
			},
			savedQueries: { list: () => [], add: vi.fn(), remove: vi.fn() },
			stateStore: { get: () => undefined, set: vi.fn() },
		},
		service: { list: () => [], getActiveId: () => undefined, onDidChange: noop },
		actions: {
			connect: vi.fn(),
			disconnect: vi.fn(),
			setActive: vi.fn(),
			remove: vi.fn(),
			submitForm: vi.fn(),
		},
		connections: { getConnectionState: () => ({ status: 'disconnected' as const }) },
		actionRunner: { run: vi.fn() },
		compareRunner: {
			startCompare: vi.fn(() => Promise.resolve({ type: 'compareResult', status: 'success' })),
			setApplyEnabled: vi.fn(),
			hasSelection: () => compareSelection.current,
			getSessionState: () => compareSession.current,
			onSelectionChanged: (listener: (hasSelection: boolean) => void) =>
				compareSelection.onDidChange(listener),
			onSessionStateChanged: (listener: (session: CompareSessionState | undefined) => void) =>
				compareSession.onDidChange(listener),
		},
		apiHistory: {
			snapshot: () => [],
			clear: vi.fn(),
			onDidAdd: noop,
			onDidClear: noop,
		},
		popOut: { open: vi.fn(), isOpen: () => false, onDidChangeOpen: noop },
	} as unknown as ShellDeps;
}

function makeWebview(): vscode.Webview {
	return { postMessage: vi.fn() } as unknown as vscode.Webview;
}

// openSettingsVia is the exported vscode-free seam for settings dispatch.

describe('openSettingsVia', () => {
	it('dispatches the vaultToolbox.openSettings command exactly once', () => {
		const executeCommand = vi.fn();
		const openSettings = openSettingsVia(executeCommand);

		openSettings();

		expect(executeCommand).toHaveBeenCalledOnce();
		expect(executeCommand).toHaveBeenCalledWith('vaultToolbox.openSettings');
	});

	it('does not dispatch on construction — only on call', () => {
		const executeCommand = vi.fn();
		openSettingsVia(executeCommand);

		expect(executeCommand).not.toHaveBeenCalled();
	});
});

describe('createShellHost routing', () => {
	it('drops non-envelope input silently', () => {
		const webview = makeWebview();
		const host = createShellHost(webview, makeDeps(), 'panel');

		host.handle(null);
		host.handle(42);
		host.handle('bad');
		host.handle({ type: 'ready' });

		expect(vi.mocked(webview.postMessage)).not.toHaveBeenCalled();
	});

	it('drops an envelope with an unknown channel', () => {
		const webview = makeWebview();
		const host = createShellHost(webview, makeDeps(), 'panel');

		host.handle({ channel: 'unknown', message: {} });

		expect(vi.mocked(webview.postMessage)).not.toHaveBeenCalled();
	});

	it('routes a shell envelope to the shell handler', () => {
		const webview = makeWebview();
		createShellHost(webview, makeDeps(), 'panel');
		const executeCommand = vi.mocked(vscode.commands.executeCommand);
		executeCommand.mockClear();

		// Route an openSettings shell message — the only observable side-effect in the panel surface
		// that doesn't require a prior ready handshake.
		const host = createShellHost(webview, makeDeps(), 'panel');
		host.handle({ channel: 'shell', message: { type: 'openSettings' } });

		expect(executeCommand).toHaveBeenCalledWith('vaultToolbox.openSettings');
	});

	it('drops a shell envelope with an unrecognized message type', () => {
		const webview = makeWebview();
		const host = createShellHost(webview, makeDeps(), 'panel');
		const executeCommand = vi.mocked(vscode.commands.executeCommand);
		executeCommand.mockClear();

		host.handle({ channel: 'shell', message: { type: 'bogus' } });

		expect(executeCommand).not.toHaveBeenCalled();
		expect(vi.mocked(webview.postMessage)).not.toHaveBeenCalled();
	});

	it('routes a compareEnvironments envelope to the compare bus', async () => {
		const webview = makeWebview();
		const deps = makeDeps();
		const host = createShellHost(webview, deps, 'panel');

		host.handle({
			channel: 'compareEnvironments',
			message: { type: 'startCompare', sourceId: 'a', targetId: 'b', kinds: { mdl: true, code: false } },
		});

		await vi.waitFor(() => expect(vi.mocked(deps.compareRunner.startCompare)).toHaveBeenCalled());
		expect(vi.mocked(deps.compareRunner.startCompare)).toHaveBeenCalledWith(
			{ sourceId: 'a', targetId: 'b', kinds: { mdl: true, code: false } },
			expect.any(AbortSignal),
		);
	});

	it('pushes a compare-tree selection change to every live surface, not just the newest', () => {
		const compareSelection = new CompareStateBroadcast(false);
		const sidebarWebview = makeWebview();
		const panelWebview = makeWebview();
		createShellHost(sidebarWebview, makeDeps(compareSelection), 'sidebar');
		// A popped-out VQL/API History panel is a second shell host over the same deps.
		createShellHost(panelWebview, makeDeps(compareSelection), 'panel');

		compareSelection.set(true);

		const envelope = {
			channel: 'compareEnvironments',
			message: { type: 'selectionChanged', hasSelection: true },
		};
		expect(vi.mocked(sidebarWebview.postMessage)).toHaveBeenCalledWith(envelope);
		expect(vi.mocked(panelWebview.postMessage)).toHaveBeenCalledWith(envelope);
	});

	it('stops pushing selection changes to a disposed surface', () => {
		const compareSelection = new CompareStateBroadcast(false);
		const panelWebview = makeWebview();
		const panelHost = createShellHost(panelWebview, makeDeps(compareSelection), 'panel');

		panelHost.dispose();
		compareSelection.set(true);

		expect(vi.mocked(panelWebview.postMessage)).not.toHaveBeenCalled();
	});

	it('pushes a comparison starting to every live surface', () => {
		const compareSession: SessionBroadcast = new CompareStateBroadcast<CompareSessionState | undefined>(
			undefined,
		);
		const sidebarWebview = makeWebview();
		const panelWebview = makeWebview();
		createShellHost(sidebarWebview, makeDeps(undefined, compareSession), 'sidebar');
		createShellHost(panelWebview, makeDeps(undefined, compareSession), 'panel');

		const session = {
			sourceId: 'src',
			targetId: 'tgt',
			kinds: { mdl: true, code: false },
			applyEnabled: false,
		};
		compareSession.set(session);

		const envelope = { channel: 'compareEnvironments', message: { type: 'sessionState', session } };
		expect(vi.mocked(sidebarWebview.postMessage)).toHaveBeenCalledWith(envelope);
		expect(vi.mocked(panelWebview.postMessage)).toHaveBeenCalledWith(envelope);
	});

	it('drops a malformed compareEnvironments envelope', () => {
		const webview = makeWebview();
		const deps = makeDeps();
		const host = createShellHost(webview, deps, 'panel');

		// Missing kinds — the compare bus drops it before reaching the runner.
		host.handle({
			channel: 'compareEnvironments',
			message: { type: 'startCompare', sourceId: 'a', targetId: 'b' },
		});

		expect(vi.mocked(deps.compareRunner.startCompare)).not.toHaveBeenCalled();
	});
});
