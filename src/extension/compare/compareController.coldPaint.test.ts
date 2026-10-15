import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A focused vscode stub: just enough surface to construct CompareController and run activate().
// `getConfiguration().get()` returns the already-applied values so enableTreeFilterMode short-circuits
// (no config write, no toast). executeCommand (setContext + `${view}.focus`) resolves as a no-op.
vi.mock('vscode', () => {
	class EventEmitter {
		event = () => () => {};
		fire(): void {}
		dispose(): void {}
	}
	return {
		EventEmitter,
		window: { createTreeView: () => ({ dispose() {} }) },
		commands: { executeCommand: vi.fn(async () => undefined) },
		workspace: {
			workspaceFolders: [{ uri: {} }],
			getConfiguration: () => ({ get: () => 'filter' }),
		},
		ConfigurationTarget: { Workspace: 2, Global: 1 },
		ProgressLocation: { Notification: 15 },
	};
});

import { CompareController } from './compareController';
import { CompareTreeProvider } from './compareTree';
import { CompareSession } from './compareSession';

/**
 * Regression guard for the VS Code TreeView cold-first-paint bug: the first render of the Vault Compare
 * view — when a comparison flips it visible and `.focus` materializes it as the tree's change event
 * fires — can mis-place a row (an MDL entry ghosts under the Code section). A manual filter toggle, i.e.
 * a *second* `tree.refresh()`, always corrects it, so {@link CompareController.activate} forces that warm
 * repaint one tick after focus via `repaintAfterColdFirstPaint`. These tests pin that behavior at the
 * controller seam (the native renderer itself is only reachable in the headed E2E suite): activate must
 * fire an initial paint AND a deferred second one. If the workaround is dropped, the deferred repaint
 * vanishes and this goes red.
 */
describe('CompareController activate: warm repaint after cold first paint', () => {
	const buildSession = (): CompareSession =>
		new CompareSession({
			source: { envId: 's', vaultDNS: 'src.veevavault.com', label: 'src' },
			target: { envId: 't', vaultDNS: 'tgt.veevavault.com', label: 'tgt' },
			targetIsProduction: false,
			mdl: {
				source: [],
				target: [{ type: 'Aicontexttype', name: 'my_context_type__c', mdl: 'RECREATE Aicontexttype my_context_type__c();' }],
			},
			code: { source: [{ name: 'com.veeva.vault.custom.triggers.Foo', source: 'class Foo {}' }], target: [] },
		});

	const activate = (controller: CompareController, session: CompareSession): Promise<void> =>
		(controller as unknown as { activate(session: CompareSession): Promise<void> }).activate(session);

	const treeRefreshSpy = (controller: CompareController) =>
		vi.spyOn((controller as unknown as { tree: CompareTreeProvider }).tree, 'refresh').mockImplementation(() => {});

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('fires the initial paint synchronously, then exactly one deferred warm repaint', async () => {
		const controller = new CompareController({ notifySelectionChanged: () => {}, notifySessionState: () => {} } as never);
		const refresh = treeRefreshSpy(controller);

		await activate(controller, buildSession());
		expect(refresh, 'the initial (cold) paint should have fired before any timer').toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(0);
		expect(refresh, 'a single deferred warm repaint should follow the cold paint').toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(1000);
		expect(refresh, 'the warm repaint must be one-shot, not a repeating timer').toHaveBeenCalledTimes(2);
	});
});
