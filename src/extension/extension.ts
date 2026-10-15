import * as vscode from 'vscode';
import { registerEnvironmentCommands } from './commands/environmentCommands';
import { ActiveConnection } from './connection/activeConnection';
import { deployMdlToVault } from './mdl/deployMdl';
import { maybeSeedE2eEnvironment } from './e2eSeed';
import { dropMdlFromVault } from './mdl/dropMdl';
import { deploySdkCodeToVault } from './sdk/deploySdkCode';
import { deleteSdkCodeFromVault } from './sdk/deleteSdkCode';
import type { ConnectionState } from './connection/types';
import { EnvironmentService } from './environments/environmentService';
import { ActiveEnvironmentStore } from './storage/activeEnvironmentStore';
import { CredentialStore } from './storage/credentialStore';
import { MetadataService } from './metadata/metadataService';
import { EnvironmentStatusBar } from './statusBar/environmentStatusBar';
import { EnvironmentStore } from './storage/environmentStore';
import { ApiHistoryStore } from './storage/apiHistoryStore';
import { QueryHistoryStore } from './storage/queryHistoryStore';
import { SavedQueryStore } from './storage/savedQueryStore';
import { VqlEditorStateStore } from './storage/vqlEditorStateStore';
import { createEnvironmentActions } from './environments/environmentActions';
import { createActionRunner } from './actions/actionRunner';
import { ConfigReportSettingsStore } from './storage/configReportSettingsStore';
import type { CompareSessionState, HostToCompareMessage } from '../shared/compareProtocol';
import type { ShellDeps } from './webview/shellHost';
import { ShellViewProvider, SHELL_VIEW_ID } from './webview/shellViewProvider';
import { ShellPanel } from './webview/shellPanel';
import { ShellSurfaceRegistry } from './webview/shellSurfaceRegistry';
import type { PopOutTab } from '../shared/shellProtocol';
import type { VqlHostDeps } from './webview/vqlWebviewHost';
import { buildConnectionManager } from './platform/vscodeAdapters';
import { CompareController } from './compare/compareController';
import { CompareStateBroadcast } from './compare/compareStateBroadcast';

export function activate(context: vscode.ExtensionContext): void {
	const apiHistory = new ApiHistoryStore();
	const connection = buildConnectionManager(context, apiHistory);
	const queryHistory = new QueryHistoryStore(context.globalState);
	const savedQueries = new SavedQueryStore(context.globalState);
	const configReportSettings = new ConfigReportSettingsStore(context.globalState);
	const service = new EnvironmentService({
		environments: new EnvironmentStore(context.globalState),
		active: new ActiveEnvironmentStore(context.workspaceState),
		credentials: new CredentialStore(context.secrets),
		connection,
	});
	// Scopes every consumer below to "whichever environment is active right now" — other
	// environments may be connected in the background (see ADR 0004), but queries, metadata, and
	// the status bar only ever act on the active one.
	const activeConnection = new ActiveConnection(connection, service);
	const metadata = new MetadataService(activeConnection);

	// Drives the `enablement` of the file-context "Deploy to Vault" command: greyed unless the active
	// environment is connected. Seeded now and re-synced on every active-connection state change.
	const syncActiveConnected = (state: ConnectionState) =>
		void vscode.commands.executeCommand(
			'setContext',
			'vaultToolbox.activeConnected',
			state.status === 'connected',
		);
	syncActiveConnected(activeConnection.getState());

	const statusBar = new EnvironmentStatusBar(service, activeConnection);
	const shellSurfaces = new ShellSurfaceRegistry();
	const vqlStateStore = new VqlEditorStateStore();

	const vqlHostDeps: VqlHostDeps = {
		connection: activeConnection,
		history: queryHistory,
		metadata,
		savedQueries,
		stateStore: vqlStateStore,
	};
	// Declared here so the compareRunner closure (inside shellDeps below) can reference it. Assigned
	// after revealApiHistoryEntry is defined (lines below); both methods are called only at runtime,
	// well after full activation, so the late assignment is safe.
	let compare: CompareController;
	// The two facts a Compare selector can't see for itself, fanned out to every live shell webview (the
	// sidebar plus any popped-out panel): the native tree's checkbox state, which gates the Apply
	// Selected button, and the live comparison, which no webview's own state survives a rebuild to know.
	const compareSelection = new CompareStateBroadcast(false);
	const compareSession = new CompareStateBroadcast<CompareSessionState | undefined>(undefined);

	const shellDeps: ShellDeps = {
		vql: vqlHostDeps,
		service,
		actions: createEnvironmentActions(service),
		connections: connection,
		actionRunner: createActionRunner(activeConnection, configReportSettings),
		compareRunner: {
			startCompare: async (request, signal) =>
				vscode.commands.executeCommand<HostToCompareMessage>(
					'vaultToolbox.compareEnvironmentsWith',
					request,
					signal,
				),
			setApplyEnabled: (enabled) => compare.setApplyEnabled(enabled),
			applySelected: () => compare.applySelected(),
			clearCompare: () => compare.clearCompare(),
			hasSelection: () => compareSelection.current,
			getSessionState: () => compareSession.current,
			onSelectionChanged: (listener) => compareSelection.onDidChange(listener),
			onSessionStateChanged: (listener) => compareSession.onDidChange(listener),
		},
		apiHistory,
		popOut: {
			open: (tab) => ShellPanel.show({ context, deps: shellDeps, surfaces: shellSurfaces, tab }),
			isOpen: (tab) => ShellPanel.isOpen(tab),
			onDidChangeOpen: (tab, listener) => {
				const disposable = ShellPanel.onDidChangeOpen(tab)(listener);
				return () => disposable.dispose();
			},
		},
	};
	const shell = new ShellViewProvider(context, shellDeps, shellSurfaces);

	// Reveal a pop-out-capable tab in whichever surface is active — the popped-out panel if open, else
	// the sidebar. Both the API History deep-link and the VQL tool handler navigate through this.
	const revealShellTab = async (tab: PopOutTab): Promise<void> => {
		if (ShellPanel.isOpen(tab)) {
			ShellPanel.show({ context, deps: shellDeps, surfaces: shellSurfaces, tab });
		} else {
			await shell.revealTab(tab);
		}
	};

	// Reveal + expand a specific API History entry — the deploy modal's "View API Call" deep-link lands here.
	const revealApiHistoryEntry = async (id: string): Promise<void> => {
		await revealShellTab('apiHistory');
		shellSurfaces.activeApiHistoryTarget()?.revealApiHistoryEntry(id);
	};

	// Compare Environments: holds two by-id connections at once (ADR 0006), so it targets the
	// ConnectionManager directly rather than the single active-connection wrapper.
	compare = new CompareController({
		connection,
		service,
		apiHistory,
		revealApiHistoryEntry,
		notifySelectionChanged: (hasSelection) => compareSelection.set(hasSelection),
		notifySessionState: (session) => compareSession.set(session),
	});

	// Reveal the Environments tab, expanding the active environment's Vault info if it's connected —
	// the status bar click lands here.
	const revealActiveEnvironment = async (): Promise<void> => {
		await shell.revealTab('environments');
		if (activeConnection.getState().status === 'connected') {
			shellSurfaces.activeEnvironmentsTarget()?.revealEnvironmentInfo();
		}
	};

	// Silently restore the previously-active environment's connection, if any (see ADR 0004) — no
	// progress notification or error toast, since this runs unprompted at startup. Under the E2E
	// replay tier, `maybeSeedE2eEnvironment` first seeds+activates the cassette's environment (a no-op
	// in production), so this same path connects it against the replay backend with no UI to drive.
	void maybeSeedE2eEnvironment(context)
		.then(() => {
			const previouslyActiveId = service.getActiveId();
			return previouslyActiveId ? service.connect(previouslyActiveId) : undefined;
		})
		.catch(() => {
			// Left disconnected; the status bar/Environments tab already surface this.
		});

	context.subscriptions.push(
		statusBar,
		vscode.window.registerWebviewViewProvider(SHELL_VIEW_ID, shell, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		// Robust open/focus: restores the view (and its Activity Bar icon) if relocated and orphaned.
		vscode.commands.registerCommand('vaultToolbox.open', () => void shell.open()),
		// Status bar click: reveal the Environments tab, expanding the active connected environment's
		// Vault info section.
		vscode.commands.registerCommand(
			'vaultToolbox.revealActiveEnvironment',
			() => void revealActiveEnvironment(),
		),
		// "Open VQL Editor": focus the shell and switch to the VQL tab.
		vscode.commands.registerCommand(
			'vaultToolbox.showVqlSidebar',
			() => void shell.revealTab('vql'),
		),
		// "Compare Environments" (palette): reveal the dedicated Compare Environments tab, where the
		// source/target pair is chosen in the webview before the comparison runs.
		vscode.commands.registerCommand(
			'vaultToolbox.compareEnvironments',
			() => void shell.revealTab('compareEnvironments'),
		),
		// "Pop out": open the VQL Editor as an editor-tab panel (the sidebar VQL tab shows a placeholder).
		vscode.commands.registerCommand('vaultToolbox.popOutVqlEditor', () => {
			ShellPanel.show({ context, deps: shellDeps, surfaces: shellSurfaces, tab: 'vql' });
		}),
		vscode.commands.registerCommand('vaultToolbox.openSettings', () =>
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'@ext:veeva.vault-toolbox-vscode',
			),
		),
		// "Deploy to Vault" on an .mdl file's context menu (MDL Execute; see ADR 0005).
		vscode.commands.registerCommand('vaultToolbox.deployMdl', (resource?: vscode.Uri) =>
			deployMdlToVault(
				{ connection: activeConnection, apiHistory, revealApiHistoryEntry },
				resource,
			),
		),
		// "Drop from Vault" on an .mdl file's context menu (MDL Execute DROP; see ADR 0005).
		vscode.commands.registerCommand('vaultToolbox.dropMdl', (resource?: vscode.Uri) =>
			dropMdlFromVault(
				{ connection: activeConnection, apiHistory, revealApiHistoryEntry },
				resource,
			),
		),
		// "Deploy to Vault" on a .java file's context menu (Deploy Java SDK Code).
		vscode.commands.registerCommand('vaultToolbox.deploySdkCode', (resource?: vscode.Uri) =>
			deploySdkCodeToVault(
				{ connection: activeConnection, apiHistory, revealApiHistoryEntry },
				resource,
			),
		),
		// "Delete from Vault" on a .java file's context menu (Delete Java SDK Code).
		vscode.commands.registerCommand('vaultToolbox.deleteSdkCode', (resource?: vscode.Uri) =>
			deleteSdkCodeFromVault(
				{ connection: activeConnection, apiHistory, revealApiHistoryEntry },
				resource,
			),
		),
		{ dispose: activeConnection.onDidChangeState(syncActiveConnected) },
		...registerEnvironmentCommands(service, shellDeps.actions, shell),
		...compare.register(),
	);
}
