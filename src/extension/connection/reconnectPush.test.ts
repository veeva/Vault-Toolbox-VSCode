import { describe, it, expect } from 'vitest';
import { ActiveConnection, type MultiConnectionPort } from './activeConnection';
import type { EnvironmentConnector } from '../environments/environmentService';
import { EnvironmentService } from '../environments/environmentService';
import { EnvironmentStore } from '../storage/environmentStore';
import { ActiveEnvironmentStore } from '../storage/activeEnvironmentStore';
import { CredentialStore } from '../storage/credentialStore';
import { MemKeyValueStore, MemSecretStore } from '../../test-support/memStores';
import { AuthType, type Environment } from '../../core/models/environment';
import type { ConnectionInfo, ConnectionState } from './types';
import type { VaultClient } from '../../core/rest/vaultClient';

/**
 * Fake connection layer that emits state changes SYNCHRONOUSLY inside connect/disconnect, exactly
 * as the real ConnectionManager.setState does. Implements both the multi-connection port (for
 * ActiveConnection.getState) and the EnvironmentConnector (for EnvironmentService).
 */
class SyncEmittingConnections implements MultiConnectionPort, EnvironmentConnector {
	private readonly states = new Map<string, ConnectionState>();
	private readonly listeners = new Set<(envId: string, state: ConnectionState) => void>();

	getConnectionState(envId: string): ConnectionState {
		return this.states.get(envId) ?? { status: 'disconnected' };
	}

	getConnectedIds(): string[] {
		return [...this.states.entries()]
			.filter(([, s]) => s.status === 'connected')
			.map(([id]) => id);
	}

	run<T>(envId: string, fn: (client: VaultClient) => Promise<T>): Promise<T> {
		if (this.getConnectionState(envId).status !== 'connected') {
			return Promise.reject(new Error('Not connected to a Vault.'));
		}
		return fn(undefined as never);
	}

	onDidChangeState(listener: (envId: string, state: ConnectionState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private setState(envId: string, state: ConnectionState): void {
		this.states.set(envId, state);
		for (const listener of this.listeners) {
			listener(envId, state);
		}
	}

	connect(env: Environment): Promise<ConnectionInfo> {
		const info: ConnectionInfo = { environment: env, apiVersion: 'v26.1' };
		this.setState(env.id, { status: 'connected', envId: env.id, info });
		return Promise.resolve(info);
	}

	disconnect(envId: string): void {
		this.setState(envId, { status: 'disconnected' });
	}
}

/** Wires ActiveConnection + EnvironmentService like the shell host does, sharing one connection layer. */
function wire() {
	const kv = new MemKeyValueStore();
	const connections = new SyncEmittingConnections();
	const service = new EnvironmentService({
		environments: new EnvironmentStore(kv),
		active: new ActiveEnvironmentStore(kv),
		credentials: new CredentialStore(new MemSecretStore()),
		connection: connections,
	});
	const activeConnection = new ActiveConnection(connections, service);

	// A single subscription must be enough: ActiveConnection's event now fires on active-pointer moves
	// too, so an active-scoped consumer (the VQL editor) that subscribes only here still sees every
	// state it must reflect. If this needed a second subscription, the seam would be leaking again.
	const pushed: string[] = [];
	activeConnection.onDidChangeState((state) => pushed.push(state.status));

	return { service, activeConnection, pushed };
}

describe('VQL connection state after reconnect', () => {
	it('reflects "connected" as the last pushed state after disconnect then reconnect', async () => {
		const { service, pushed } = wire();
		const env = await service.add(
			{ label: 'Sandbox', vaultDNS: 'myco.veevavault.com', username: 'a', authType: AuthType.Basic },
			'pw',
		);

		await service.connect(env.id);
		await service.disconnect(env.id);
		pushed.length = 0; // only care about the reconnect from here

		await service.connect(env.id);

		expect(pushed.at(-1)).toBe('connected');
	});
});
