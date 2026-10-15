import { describe, it, expect } from 'vitest';
import { KeyedListStore, KeyedValueStore } from './keyedStore';
import { MemKeyValueStore } from '../../test-support/memStores';

describe('KeyedValueStore', () => {
	it('is undefined until set, round-trips, and clears with undefined', async () => {
		const store = new KeyedValueStore<string>(new MemKeyValueStore(), 'k');
		expect(store.get()).toBeUndefined();

		await store.set('v');
		expect(store.get()).toBe('v');

		await store.set(undefined);
		expect(store.get()).toBeUndefined();
	});
});

describe('KeyedListStore', () => {
	it('defaults to an empty list', () => {
		expect(new KeyedListStore<number>(new MemKeyValueStore(), 'k').list()).toEqual([]);
	});

	it('degrades a corrupt (non-array) persisted value to an empty list', async () => {
		const kv = new MemKeyValueStore();
		// Simulate schema drift / an older version leaving a non-array under the key.
		await kv.update('k', { not: 'an array' });
		expect(new KeyedListStore<number>(kv, 'k').list()).toEqual([]);
	});

	it('applies a pure transform, persists, and returns the result', async () => {
		const store = new KeyedListStore<number>(new MemKeyValueStore(), 'k');

		const next = await store.mutate((current) => [...current, 1]);

		expect(next).toEqual([1]);
		expect(store.list()).toEqual([1]);
	});

	it('does not mutate the persisted array in place across calls', async () => {
		const kv = new MemKeyValueStore();
		const store = new KeyedListStore<number>(kv, 'k');
		await store.mutate((current) => [...current, 1]);

		const first = store.list();
		await store.mutate((current) => [...current, 2]);

		expect(first).toEqual([1]);
		expect(store.list()).toEqual([1, 2]);
	});

	it('overwrites the whole list with set', async () => {
		const store = new KeyedListStore<number>(new MemKeyValueStore(), 'k');
		await store.mutate((current) => [...current, 1, 2, 3]);

		await store.set([]);

		expect(store.list()).toEqual([]);
	});
});
