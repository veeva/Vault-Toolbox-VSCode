import { describe, it, expect } from 'vitest';
import { SavedQueryStore } from './savedQueryStore';
import { MemKeyValueStore } from '../../test-support/memStores';

describe('SavedQueryStore', () => {
	it('starts empty', () => {
		expect(new SavedQueryStore(new MemKeyValueStore()).list()).toEqual([]);
	});

	it('persists newest-first and replaces a same-named entry', async () => {
		const store = new SavedQueryStore(new MemKeyValueStore());

		await store.add('docs', 'SELECT id FROM documents');
		await store.add('users', 'SELECT id FROM users');
		const list = await store.add('docs', 'SELECT name__v FROM documents');

		expect(list).toEqual([
			{ name: 'docs', vql: 'SELECT name__v FROM documents' },
			{ name: 'users', vql: 'SELECT id FROM users' },
		]);
		expect(store.list()).toEqual(list);
	});

	it('removes by name and persists', async () => {
		const store = new SavedQueryStore(new MemKeyValueStore());
		await store.add('docs', 'SELECT id FROM documents');
		await store.add('users', 'SELECT id FROM users');

		const list = await store.remove('docs');

		expect(list).toEqual([{ name: 'users', vql: 'SELECT id FROM users' }]);
		expect(store.list()).toEqual(list);
	});
});
