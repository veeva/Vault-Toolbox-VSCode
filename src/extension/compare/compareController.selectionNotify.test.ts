import { describe, it, expect, vi } from 'vitest';

// A focused vscode stub: just enough surface to construct CompareController and drive the two paths
// that change the tree's checkbox state — a checkbox click and a post-apply recompute.
vi.mock('vscode', () => {
	class EventEmitter {
		event = () => () => {};
		fire(): void {}
		dispose(): void {}
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
		Uri: { from: (parts: unknown) => parts },
		ConfigurationTarget: { Workspace: 2, Global: 1 },
		ProgressLocation: { Notification: 15 },
		TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
	};
});

import * as vscode from 'vscode';
import { CompareController } from './compareController';
import { CompareSession } from './compareSession';
import type { CompareEntry } from '../../core/compare/compareComponents';
import type { CompareApplyPort } from '../../core/compare/compareApply';

/** A comparison holding one target-only code class — checkable, and removed by a delete apply. */
const buildSession = (): CompareSession =>
	new CompareSession({
		source: { envId: 's', vaultDNS: 'src.veevavault.com', label: 'src' },
		target: { envId: 't', vaultDNS: 'tgt.veevavault.com', label: 'tgt' },
		targetIsProduction: false,
		mdl: undefined,
		code: { source: [], target: [{ name: 'com.veeva.vault.custom.actions.Gone', source: 'class Gone {}' }] },
	});

const activate = (controller: CompareController, session: CompareSession): Promise<void> =>
	(controller as unknown as { activate(session: CompareSession): Promise<void> }).activate(session);

const checkboxChange = (controller: CompareController, entry: CompareEntry): void =>
	(
		controller as unknown as {
			handleCheckboxChange(event: { items: [unknown, number][] }): void;
		}
	).handleCheckboxChange({ items: [[{ kind: 'entry', entry }, vscode.TreeItemCheckboxState.Checked]] });

const applyRecompute = (
	controller: CompareController,
	session: CompareSession,
	entry: CompareEntry,
): Promise<void> =>
	(
		controller as unknown as {
			applyRecompute(
				session: CompareSession,
				entry: CompareEntry,
				operation: string,
				port: CompareApplyPort,
			): Promise<void>;
		}
	).applyRecompute(session, entry, 'delete', {} as CompareApplyPort);

describe('CompareController session-state publishing', () => {
	it('publishes the comparison when one becomes current, so a selector that mounted mid-run catches up', async () => {
		const notifySessionState = vi.fn();
		const controller = new CompareController({
			notifySelectionChanged: vi.fn(),
			notifySessionState,
		} as never);

		await activate(controller, buildSession());

		expect(notifySessionState).toHaveBeenCalledWith({
			sourceId: 's',
			targetId: 't',
			kinds: { mdl: false, code: true },
			applyEnabled: false,
		});
	});

	it('publishes the absence of a comparison when one is cleared', async () => {
		const notifySessionState = vi.fn();
		const controller = new CompareController({
			notifySelectionChanged: vi.fn(),
			notifySessionState,
		} as never);
		await activate(controller, buildSession());
		notifySessionState.mockClear();

		controller.clearCompare();

		expect(notifySessionState).toHaveBeenCalledWith(undefined);
	});

	it('ignores a cleared comparison still finishing its writes, instead of resurrecting it', async () => {
		const notifySelectionChanged = vi.fn();
		const controller = new CompareController({
			notifySelectionChanged,
			notifySessionState: vi.fn(),
		} as never);
		const session = buildSession();
		await activate(controller, session);
		const entry = session.visibleEntries()[0];
		checkboxChange(controller, entry);
		controller.clearCompare();
		notifySelectionChanged.mockClear();
		vi.mocked(vscode.commands.executeCommand).mockClear();

		// An apply that was already in flight when "New Compare" was clicked, recomputing afterwards.
		await applyRecompute(controller, session, entry);

		expect(notifySelectionChanged).not.toHaveBeenCalled();
		expect(vi.mocked(vscode.commands.executeCommand)).not.toHaveBeenCalledWith(
			'setContext',
			'vaultToolbox.compareActive',
			true,
		);
	});
});

describe('CompareController.sessionState', () => {
	it('reports nothing when no comparison is active', () => {
		expect(new CompareController({ notifySelectionChanged: vi.fn(), notifySessionState: vi.fn() } as never).sessionState()).toBeUndefined();
	});

	it('reports the pair, the kinds actually fetched, and the apply gate', async () => {
		const controller = new CompareController({ notifySelectionChanged: vi.fn(), notifySessionState: vi.fn() } as never);
		const session = buildSession();
		await activate(controller, session);
		session.setApplyEnabled(true);

		expect(controller.sessionState()).toEqual({
			sourceId: 's',
			targetId: 't',
			// This comparison fetched code only — the selector's kind toggles must come back the same way.
			kinds: { mdl: false, code: true },
			applyEnabled: true,
		});
	});
});

describe('CompareController selection notifications', () => {
	it('notifies a selection when an entry is checked in the tree', async () => {
		const notifySelectionChanged = vi.fn();
		const controller = new CompareController({ notifySelectionChanged, notifySessionState: vi.fn() } as never);
		const session = buildSession();
		await activate(controller, session);
		notifySelectionChanged.mockClear();

		checkboxChange(controller, session.visibleEntries()[0]);

		expect(notifySelectionChanged).toHaveBeenCalledWith(true);
	});

	it('notifies no selection once a post-apply recompute drops the checked entry', async () => {
		const notifySelectionChanged = vi.fn();
		const controller = new CompareController({ notifySelectionChanged, notifySessionState: vi.fn() } as never);
		const session = buildSession();
		await activate(controller, session);
		const entry = session.visibleEntries()[0];
		checkboxChange(controller, entry);
		notifySelectionChanged.mockClear();

		await applyRecompute(controller, session, entry);

		expect(notifySelectionChanged).toHaveBeenCalledWith(false);
	});
});
