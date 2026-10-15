import { describe, it, expect } from 'vitest';
import { ActiveEnvironmentStore } from './activeEnvironmentStore';
import { MemKeyValueStore } from '../../test-support/memStores';

describe('ActiveEnvironmentStore', () => {
	it('is undefined until set', () => {
		const store = new ActiveEnvironmentStore(new MemKeyValueStore());
		expect(store.get()).toBeUndefined();
	});

	it('sets and reads the active id', async () => {
		const store = new ActiveEnvironmentStore(new MemKeyValueStore());
		await store.set('env-1');
		expect(store.get()).toBe('env-1');
	});

	it('clears the active id', async () => {
		const store = new ActiveEnvironmentStore(new MemKeyValueStore());
		await store.set('env-1');
		await store.clear();
		expect(store.get()).toBeUndefined();
	});
});
