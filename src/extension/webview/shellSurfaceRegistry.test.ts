import { describe, it, expect } from 'vitest';
import { ShellSurfaceRegistry, type ShellSurfaceHost } from './shellSurfaceRegistry';

function fakeHost(): ShellSurfaceHost {
	return {
		postVql: () => undefined,
		revealApiHistoryEntry: () => undefined,
		revealEnvironmentInfo: () => undefined,
	};
}

describe('ShellSurfaceRegistry', () => {
	it('has no active target when nothing is registered', () => {
		const registry = new ShellSurfaceRegistry();

		expect(registry.activeApiHistoryTarget()).toBeUndefined();
		expect(registry.activeEnvironmentsTarget()).toBeUndefined();
	});

	it('targets the sidebar once it registers', () => {
		const registry = new ShellSurfaceRegistry();
		const sidebar = fakeHost();

		registry.registerSidebar(sidebar);

		expect(registry.activeApiHistoryTarget()).toBe(sidebar);
		expect(registry.activeEnvironmentsTarget()).toBe(sidebar);
	});

	it('prefers a tab’s panel over the sidebar once that panel registers', () => {
		const registry = new ShellSurfaceRegistry();
		const sidebar = fakeHost();
		const apiHistoryPanel = fakeHost();

		registry.registerSidebar(sidebar);
		registry.registerPanel('apiHistory', apiHistoryPanel);

		expect(registry.activeApiHistoryTarget()).toBe(apiHistoryPanel);
		// Environments is never poppable, so it always stays on the sidebar.
		expect(registry.activeEnvironmentsTarget()).toBe(sidebar);
	});

	it('resolves each poppable tab’s panel independently', () => {
		const registry = new ShellSurfaceRegistry();
		const sidebar = fakeHost();
		const vqlPanel = fakeHost();
		const apiHistoryPanel = fakeHost();
		registry.registerSidebar(sidebar);
		registry.registerPanel('vql', vqlPanel);
		registry.registerPanel('apiHistory', apiHistoryPanel);

		// A VQL panel does not divert an API History reveal — that still resolves to its own panel.
		expect(registry.activeApiHistoryTarget()).toBe(apiHistoryPanel);
	});

	it('falls back to the sidebar once a panel unregisters', () => {
		const registry = new ShellSurfaceRegistry();
		const sidebar = fakeHost();
		const panel = fakeHost();
		registry.registerSidebar(sidebar);
		registry.registerPanel('apiHistory', panel);

		registry.unregisterPanel('apiHistory', panel);

		expect(registry.activeApiHistoryTarget()).toBe(sidebar);
	});

	it('ignores a stale unregister for a panel that already got replaced', () => {
		const registry = new ShellSurfaceRegistry();
		const stalePanel = fakeHost();
		const currentPanel = fakeHost();
		registry.registerPanel('apiHistory', stalePanel);
		registry.registerPanel('apiHistory', currentPanel);

		registry.unregisterPanel('apiHistory', stalePanel);

		expect(registry.activeApiHistoryTarget()).toBe(currentPanel);
	});

	it('ignores a stale unregister for a sidebar that already got replaced', () => {
		const registry = new ShellSurfaceRegistry();
		const staleSidebar = fakeHost();
		const currentSidebar = fakeHost();
		registry.registerSidebar(staleSidebar);
		registry.registerSidebar(currentSidebar);

		registry.unregisterSidebar(staleSidebar);

		expect(registry.activeApiHistoryTarget()).toBe(currentSidebar);
	});

	it('has no active target once the sidebar unregisters', () => {
		const registry = new ShellSurfaceRegistry();
		const sidebar = fakeHost();
		registry.registerSidebar(sidebar);

		registry.unregisterSidebar(sidebar);

		expect(registry.activeApiHistoryTarget()).toBeUndefined();
	});
});
