import { describe, it, expect, vi } from 'vitest';
import { CompareStateBroadcast } from './compareStateBroadcast';

describe('CompareStateBroadcast', () => {
	it('starts at the value it was constructed with', () => {
		expect(new CompareStateBroadcast(false).current).toBe(false);
	});

	it('publishes a new value to every subscriber, not just the newest', () => {
		const broadcast = new CompareStateBroadcast(false);
		const sidebar = vi.fn();
		const panel = vi.fn();
		broadcast.onDidChange(sidebar);
		broadcast.onDidChange(panel);

		broadcast.set(true);

		expect(sidebar).toHaveBeenCalledWith(true);
		expect(panel).toHaveBeenCalledWith(true);
	});

	it('retains the latest value for a subscriber that mounts later', () => {
		const broadcast = new CompareStateBroadcast(false);

		broadcast.set(true);

		expect(broadcast.current).toBe(true);
	});

	it('stops publishing to an unsubscribed listener', () => {
		const broadcast = new CompareStateBroadcast(false);
		const listener = vi.fn();
		const unsubscribe = broadcast.onDidChange(listener);

		unsubscribe();
		broadcast.set(true);

		expect(listener).not.toHaveBeenCalled();
	});

	it('keeps publishing to the remaining listeners after one unsubscribes', () => {
		const broadcast = new CompareStateBroadcast(false);
		const sidebar = vi.fn();
		const unsubscribePanel = broadcast.onDidChange(vi.fn());
		broadcast.onDidChange(sidebar);

		unsubscribePanel();
		broadcast.set(true);

		expect(sidebar).toHaveBeenCalledWith(true);
	});

	it('carries a whole value, so an absent comparison is publishable too', () => {
		const broadcast = new CompareStateBroadcast<{ sourceId: string } | undefined>({ sourceId: 'src' });
		const listener = vi.fn();
		broadcast.onDidChange(listener);

		broadcast.set(undefined);

		expect(listener).toHaveBeenCalledWith(undefined);
		expect(broadcast.current).toBeUndefined();
	});
});
