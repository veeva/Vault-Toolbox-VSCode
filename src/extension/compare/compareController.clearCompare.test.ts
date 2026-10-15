import { describe, it, expect, vi } from 'vitest';

// A focused vscode stub: just enough surface to construct CompareController and exercise clearCompare().
vi.mock('vscode', () => {
	class EventEmitter {
		event = () => () => {};
		fire(): void {}
		dispose(): void {}
	}
	class TabInputTextDiff {
		constructor(
			public readonly original: { scheme: string },
			public readonly modified: { scheme: string },
		) {}
	}
	return {
		EventEmitter,
		window: {
			createTreeView: () => ({ dispose() {} }),
			tabGroups: { all: [] as unknown[], close: vi.fn(async () => undefined) },
		},
		commands: { executeCommand: vi.fn(async () => undefined) },
		workspace: {
			workspaceFolders: [{ uri: {} }],
			getConfiguration: () => ({ get: () => 'filter' }),
		},
		ConfigurationTarget: { Workspace: 2, Global: 1 },
		ProgressLocation: { Notification: 15 },
		TabInputTextDiff,
	};
});

import * as vscode from 'vscode';
import { CompareController } from './compareController';
import { CompareTreeProvider } from './compareTree';
import { CompareSession } from './compareSession';
import { COMPARE_SCHEME } from './compareContentProvider';

const buildSession = (): CompareSession =>
	new CompareSession({
		source: { envId: 's', vaultDNS: 'src.veevavault.com', label: 'src' },
		target: { envId: 't', vaultDNS: 'tgt.veevavault.com', label: 'tgt' },
		targetIsProduction: false,
		mdl: {
			source: [],
			target: [{ type: 'Aicontexttype', name: 'my_context_type__c', mdl: 'RECREATE Aicontexttype my_context_type__c();' }],
		},
		code: undefined,
	});

const activate = (controller: CompareController, session: CompareSession): Promise<void> =>
	(controller as unknown as { activate(session: CompareSession): Promise<void> }).activate(session);

const getSession = (controller: CompareController): CompareSession | undefined =>
	(controller as unknown as { session: CompareSession | undefined }).session;

describe('CompareController.clearCompare', () => {
	it('drops the session, resets context keys, and notifies no selection — a no-op with nothing to clear', () => {
		const notifySelectionChanged = vi.fn();
		const controller = new CompareController({ notifySelectionChanged, notifySessionState: vi.fn() } as never);

		controller.clearCompare();

		expect(notifySelectionChanged).not.toHaveBeenCalled();
	});

	it('clears an active session, refreshes the tree, resets context keys, and closes open diff tabs', async () => {
		const notifySelectionChanged = vi.fn();
		const controller = new CompareController({ notifySelectionChanged, notifySessionState: vi.fn() } as never);
		await activate(controller, buildSession());
		expect(getSession(controller)).toBeDefined();

		const refresh = vi.spyOn(
			(controller as unknown as { tree: CompareTreeProvider }).tree,
			'refresh',
		);
		const TabInputTextDiff = (
			vscode as unknown as { TabInputTextDiff: new (o: { scheme: string }, m: { scheme: string }) => unknown }
		).TabInputTextDiff;
		const matchingTab = { input: new TabInputTextDiff({ scheme: COMPARE_SCHEME }, { scheme: 'file' }) };
		const otherTab = { input: new TabInputTextDiff({ scheme: 'file' }, { scheme: 'file' }) };
		(vscode.window.tabGroups as unknown as { all: unknown[] }).all = [{ tabs: [matchingTab, otherTab] }];

		controller.clearCompare();
		await Promise.resolve();
		await Promise.resolve();

		expect(getSession(controller)).toBeUndefined();
		expect(refresh).toHaveBeenCalled();
		expect(notifySelectionChanged).toHaveBeenCalledWith(false);
		expect(vscode.window.tabGroups.close).toHaveBeenCalledWith([matchingTab]);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			'setContext',
			'vaultToolbox.compareActive',
			false,
		);
	});
});
