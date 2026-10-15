import { describe, it, expect } from 'vitest';
import { EnvironmentStore } from './environmentStore';
import { MemKeyValueStore } from '../../test-support/memStores';
import { AuthType, createEnvironment } from '../../core/models/environment';

describe('EnvironmentStore', () => {
	it('starts empty', () => {
		const store = new EnvironmentStore(new MemKeyValueStore());
		expect(store.list()).toEqual([]);
	});

	it('round-trips upsert / list / get', async () => {
		const store = new EnvironmentStore(new MemKeyValueStore());
		const env = createEnvironment({
			label: 'Sandbox',
			vaultDNS: 'myco.veevavault.com',
			username: 'admin',
			authType: AuthType.Basic,
		});

		await store.upsert(env);

		expect(store.list()).toHaveLength(1);
		expect(store.get(env.id)).toEqual(env);
	});

	it('replaces an existing environment instead of duplicating', async () => {
		const store = new EnvironmentStore(new MemKeyValueStore());
		const env = createEnvironment({
			label: 'Sandbox',
			vaultDNS: 'myco.veevavault.com',
			authType: AuthType.SessionId,
		});
		await store.upsert(env);

		await store.upsert({ ...env, label: 'Renamed' });

		expect(store.list()).toHaveLength(1);
		expect(store.get(env.id)?.label).toBe('Renamed');
	});

	it('removes by id', async () => {
		const store = new EnvironmentStore(new MemKeyValueStore());
		const env = createEnvironment({
			label: 'Sandbox',
			vaultDNS: 'myco.veevavault.com',
			authType: AuthType.Basic,
		});
		await store.upsert(env);

		await store.remove(env.id);

		expect(store.list()).toEqual([]);
		expect(store.get(env.id)).toBeUndefined();
	});
});
