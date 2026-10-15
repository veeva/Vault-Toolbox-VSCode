import { describe, it, expect } from 'vitest';
import { CredentialStore } from './credentialStore';
import { EnvironmentStore } from './environmentStore';
import { MemKeyValueStore, MemSecretStore } from '../../test-support/memStores';
import { AuthType, createEnvironment } from '../../core/models/environment';

describe('CredentialStore', () => {
	it('round-trips set / get / delete', async () => {
		const secrets = new MemSecretStore();
		const creds = new CredentialStore(secrets);

		await creds.set('env-1', 'hunter2');
		expect(await creds.get('env-1')).toBe('hunter2');

		await creds.delete('env-1');
		expect(await creds.get('env-1')).toBeUndefined();
	});

	it("namespaces secrets by environment id so they don't collide", async () => {
		const secrets = new MemSecretStore();
		const creds = new CredentialStore(secrets);

		await creds.set('abc', 'secret-abc');
		await creds.set('xyz', 'secret-xyz');

		expect(await creds.get('abc')).toBe('secret-abc');
		expect(await creds.get('xyz')).toBe('secret-xyz');
	});

	it('never leaks the secret into the environment (globalState) backend', async () => {
		const kv = new MemKeyValueStore();
		const secrets = new MemSecretStore();
		const envStore = new EnvironmentStore(kv);
		const creds = new CredentialStore(secrets);

		const env = createEnvironment({
			label: 'Sandbox',
			vaultDNS: 'myco.veevavault.com',
			username: 'admin',
			authType: AuthType.Basic,
		});
		await envStore.upsert(env);
		await creds.set(env.id, 'super-secret-password');

		// Whatever globalState holds, it must not contain the secret value anywhere.
		const globalStateDump = JSON.stringify([...kv.map.entries()]);
		expect(globalStateDump).not.toContain('super-secret-password');
	});
});
