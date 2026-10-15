import { describe, it, expect } from 'vitest';
import { EnvironmentService, type EnvironmentConnector } from './environmentService';
import { EnvironmentStore } from '../storage/environmentStore';
import { ActiveEnvironmentStore } from '../storage/activeEnvironmentStore';
import { CredentialStore } from '../storage/credentialStore';
import { MemKeyValueStore, MemSecretStore } from '../../test-support/memStores';
import { AuthType, type Environment } from '../../core/models/environment';
import type { ConnectionInfo, ConnectionState } from '../connection/types';

/** Records connect/disconnect calls and tracks connection state per environment id. */
class FakeConnector implements EnvironmentConnector {
	states = new Map<string, ConnectionState>();
	connectedIds = new Set<string>();
	connected: Environment[] = [];
	disconnected: string[] = [];

	connect(env: Environment): Promise<ConnectionInfo> {
		this.connected.push(env);
		const info: ConnectionInfo = { environment: env, apiVersion: 'v26.1' };
		this.states.set(env.id, { status: 'connected', envId: env.id, info });
		this.connectedIds.add(env.id);
		return Promise.resolve(info);
	}

	disconnect(envId: string): void {
		this.disconnected.push(envId);
		this.states.set(envId, { status: 'disconnected' });
		this.connectedIds.delete(envId);
	}

	getConnectionState(envId: string): ConnectionState {
		return this.states.get(envId) ?? { status: 'disconnected' };
	}

	getConnectedIds(): string[] {
		return [...this.connectedIds];
	}
}

function makeService() {
	const kv = new MemKeyValueStore();
	const secrets = new MemSecretStore();
	const environments = new EnvironmentStore(kv);
	const active = new ActiveEnvironmentStore(kv);
	const credentials = new CredentialStore(secrets);
	const connection = new FakeConnector();
	const service = new EnvironmentService({ environments, active, credentials, connection });
	return { service, environments, active, credentials, connection, secrets };
}

const basicInput = {
	label: 'Sandbox',
	vaultDNS: 'https://MyCo.veevavault.com/',
	username: 'admin',
	authType: AuthType.Basic,
};

describe('EnvironmentService', () => {
	it('add persists the environment (normalized DNS) and its secret', async () => {
		const { service, environments, credentials } = makeService();

		const env = await service.add(basicInput, 'hunter2');

		expect(environments.list()).toHaveLength(1);
		expect(env.vaultDNS).toBe('myco.veevavault.com');
		expect(await credentials.get(env.id)).toBe('hunter2');
	});

	it('edit updates fields, keeps the id, and only replaces the secret when given', async () => {
		const { service, credentials } = makeService();
		const env = await service.add(basicInput, 'hunter2');

		const edited = await service.edit(env.id, { ...basicInput, label: 'Renamed' });
		expect(edited.id).toBe(env.id);
		expect(edited.label).toBe('Renamed');
		expect(await credentials.get(env.id)).toBe('hunter2'); // secret untouched

		await service.edit(env.id, { ...basicInput, label: 'Renamed' }, 'newpass');
		expect(await credentials.get(env.id)).toBe('newpass');
	});

	it('edit drops the username when switching to Session-ID auth', async () => {
		const { service } = makeService();
		const env = await service.add(basicInput, 'hunter2');

		const edited = await service.edit(env.id, {
			label: 'Sandbox',
			vaultDNS: 'myco.veevavault.com',
			username: 'admin',
			authType: AuthType.SessionId,
		});

		expect(edited.username).toBeUndefined();
		expect(edited.authType).toBe(AuthType.SessionId);
	});

	it('remove deletes the environment and its secret', async () => {
		const { service, environments, credentials } = makeService();
		const env = await service.add(basicInput, 'hunter2');

		await service.remove(env.id);

		expect(environments.list()).toEqual([]);
		expect(await credentials.get(env.id)).toBeUndefined();
	});

	it('remove clears the active pointer and drops a live connection to that env', async () => {
		const { service, active, connection } = makeService();
		const env = await service.add(basicInput, 'hunter2');
		await service.connect(env.id);
		expect(active.get()).toBe(env.id);

		await service.remove(env.id);

		expect(active.get()).toBeUndefined();
		expect(connection.disconnected).toEqual([env.id]);
	});

	it('remove leaves an unrelated live connection alone', async () => {
		const { service, connection } = makeService();
		const keep = await service.add(basicInput, 'a');
		const drop = await service.add({ ...basicInput, label: 'Other' }, 'b');
		await service.connect(keep.id);

		await service.remove(drop.id);

		expect(connection.disconnected).toEqual([]);
		expect(connection.getConnectionState(keep.id).status).toBe('connected');
	});

	describe('setActive', () => {
		it('rejects an unknown environment id', async () => {
			const { service } = makeService();
			await expect(service.setActive('nope')).rejects.toThrow(/Unknown environment/);
		});

		it('rejects an environment that is not connected', async () => {
			const { service } = makeService();
			const env = await service.add(basicInput, 'hunter2');

			await expect(service.setActive(env.id)).rejects.toThrow(/not connected/);
		});

		it('switches active between two already-connected environments', async () => {
			const { service, active } = makeService();
			const kima = await service.add(basicInput, 'hunter2');
			const bunk = await service.add({ ...basicInput, label: 'Other' }, 'hunter3');
			await service.connect(kima.id); // bootstraps active to kima (nothing was active yet)
			await service.connect(bunk.id); // stays connected in the background; doesn't steal active
			expect(active.get()).toBe(kima.id);

			await service.setActive(bunk.id);

			expect(active.get()).toBe(bunk.id);
		});
	});

	describe('connect', () => {
		it('resolves the env, delegates to the connector, and bootstraps active when nothing is active', async () => {
			const { service, active, connection } = makeService();
			const env = await service.add(basicInput, 'hunter2');

			const info = await service.connect(env.id);

			expect(info.environment.id).toBe(env.id);
			expect(active.get()).toBe(env.id);
			expect(connection.connected).toHaveLength(1);
			await expect(service.connect('nope')).rejects.toThrow(/Unknown environment/);
		});

		it('does not steal active from an already-active environment', async () => {
			const { service, active } = makeService();
			const kima = await service.add(basicInput, 'hunter2');
			const bunk = await service.add({ ...basicInput, label: 'Other' }, 'hunter3');
			await service.connect(kima.id);

			await service.connect(bunk.id);

			expect(active.get()).toBe(kima.id);
		});

		it('makeActive: true always takes over active, even from an already-active environment', async () => {
			const { service, active } = makeService();
			const kima = await service.add(basicInput, 'hunter2');
			const bunk = await service.add({ ...basicInput, label: 'Other' }, 'hunter3');
			await service.connect(kima.id);

			await service.connect(bunk.id, { makeActive: true });

			expect(active.get()).toBe(bunk.id);
		});

		it('makeActive: false never bootstraps active, even when nothing is active yet', async () => {
			const { service, active } = makeService();
			const env = await service.add(basicInput, 'hunter2');

			await service.connect(env.id, { makeActive: false });

			expect(active.get()).toBeUndefined();
		});

		it("adopts the Vault's own name as the label once it's known", async () => {
			const { service, environments, connection } = makeService();
			const env = await service.add({ ...basicInput, label: 'myco.veevavault.com' }, 'hunter2');
			let changes = 0;
			service.onDidChange(() => changes++);

			connection.connect = (target) => {
				connection.connected.push(target);
				const info: ConnectionInfo = {
					environment: target,
					apiVersion: 'v26.1',
					vaultName: 'PromoMats',
				};
				connection.states.set(target.id, { status: 'connected', envId: target.id, info });
				connection.connectedIds.add(target.id);
				return Promise.resolve(info);
			};

			const info = await service.connect(env.id);

			expect(info.vaultName).toBe('PromoMats');
			expect(environments.get(env.id)?.label).toBe('PromoMats');
			expect(changes).toBe(1); // one extra onDidChange from the label update
		});
	});

	describe('disconnect', () => {
		it('falls back active to another still-connected environment', async () => {
			const { service, active, connection } = makeService();
			const kima = await service.add(basicInput, 'hunter2');
			const bunk = await service.add({ ...basicInput, label: 'Other' }, 'hunter3');
			await service.connect(kima.id);
			await service.connect(bunk.id);
			await service.setActive(bunk.id);

			await service.disconnect(bunk.id);

			expect(connection.disconnected).toEqual([bunk.id]);
			expect(active.get()).toBe(kima.id); // falls back to `kima`, which is still connected
			expect(connection.getConnectionState(kima.id).status).toBe('connected');
		});

		it('clears active when disconnecting it with no other connected environment', async () => {
			const { service, active, connection } = makeService();
			const kima = await service.add(basicInput, 'hunter2');
			await service.connect(kima.id);

			await service.disconnect(kima.id);

			expect(connection.disconnected).toEqual([kima.id]);
			expect(active.get()).toBeUndefined();
		});

		it('fires onDidChange when disconnecting the active environment', async () => {
			const { service } = makeService();
			const kima = await service.add(basicInput, 'hunter2');
			await service.connect(kima.id);
			let changes = 0;
			service.onDidChange(() => changes++);

			await service.disconnect(kima.id);

			expect(changes).toBe(1);
		});

		it('leaves active untouched when disconnecting a different, inactive environment', async () => {
			const { service, active } = makeService();
			const kima = await service.add(basicInput, 'hunter2');
			const bunk = await service.add({ ...basicInput, label: 'Other' }, 'hunter3');
			await service.connect(kima.id);
			await service.connect(bunk.id);

			await service.disconnect(bunk.id);

			expect(active.get()).toBe(kima.id);
		});
	});

	it('fires onDidChange on add, edit, setActive, and remove (and stops after unsubscribe)', async () => {
		const { service } = makeService();
		let changes = 0;
		const unsubscribe = service.onDidChange(() => {
			changes++;
		});

		const kima = await service.add(basicInput, 'hunter2'); // 1
		await service.edit(kima.id, { ...basicInput, label: 'Renamed' }); // 2
		const bunk = await service.add(basicInput, 'other'); // 3
		await service.connect(kima.id); // 4 — bootstraps active, so observers learn the pointer moved
		await service.connect(bunk.id); // stays in the background — no emitChange
		await service.setActive(bunk.id); // 5
		await service.remove(bunk.id); // 6
		expect(changes).toBe(6);

		unsubscribe();
		await service.add(basicInput, 'again');
		expect(changes).toBe(6);
	});

	describe('isConnected', () => {
		it('reflects the connector state for the given environment', async () => {
			const { service } = makeService();
			const env = await service.add(basicInput, 'hunter2');
			expect(service.isConnected(env.id)).toBe(false);

			await service.connect(env.id);

			expect(service.isConnected(env.id)).toBe(true);
		});
	});
});
