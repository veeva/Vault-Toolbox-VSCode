import { describe, it, expect } from 'vitest';
import { QueryHistoryStore } from './queryHistoryStore';
import { MemKeyValueStore } from '../../test-support/memStores';

describe('QueryHistoryStore', () => {
	it('starts empty', () => {
		expect(new QueryHistoryStore(new MemKeyValueStore()).list()).toEqual([]);
	});

	it('persists newest-first and dedups on re-add', async () => {
		const store = new QueryHistoryStore(new MemKeyValueStore());

		await store.add('SELECT id FROM documents');
		await store.add('SELECT id FROM users');
		const list = await store.add('SELECT id FROM documents');

		expect(list).toEqual(['SELECT id FROM documents', 'SELECT id FROM users']);
		expect(store.list()).toEqual(list);
	});

	it('clears the history', async () => {
		const store = new QueryHistoryStore(new MemKeyValueStore());
		await store.add('SELECT id FROM documents');

		await store.clear();

		expect(store.list()).toEqual([]);
	});
});
