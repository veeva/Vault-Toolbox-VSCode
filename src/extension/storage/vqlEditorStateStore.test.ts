import { describe, it, expect } from 'vitest';
import { VqlEditorStateStore } from './vqlEditorStateStore';

describe('VqlEditorStateStore', () => {
	it('is undefined until set', () => {
		const store = new VqlEditorStateStore();
		expect(store.get()).toBeUndefined();
	});

	it('returns the last state set', () => {
		const store = new VqlEditorStateStore();
		const state = { vql: 'SELECT id', viewMode: 'grid' as const };

		store.set(state);

		expect(store.get()).toBe(state);
	});

	it('overwrites the previous state', () => {
		const store = new VqlEditorStateStore();
		store.set({ vql: 'SELECT id', viewMode: 'grid' });

		const next = { vql: 'SELECT name__v', viewMode: 'json' as const };
		store.set(next);

		expect(store.get()).toBe(next);
	});
});
