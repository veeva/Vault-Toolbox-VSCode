import { describe, it, expect, vi } from 'vitest';
import { ActiveConnection, type ActiveEnvironmentPort, type MultiConnectionPort } from './activeConnection';
import type { ConnectionState } from './types';

class FakeConnections implements MultiConnectionPort {
	states = new Map<string, ConnectionState>();
	listeners = new Set<(envId: string, state: ConnectionState) => void>();

	getConnectionState(envId: string): ConnectionState {
		return this.states.get(envId) ?? { status: 'disconnected' };
	}

	run<T>(envId: string, fn: (client: never) => Promise<T>): Promise<T> {
		const state = this.getConnectionState(envId);
		if (state.status !== 'connected') {
			return Promise.reject(new Error('Not connected to a Vault.'));
		}
		return fn(undefined as never);
	}

	onDidChangeState(listener: (envId: string, state: ConnectionState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(envId: string, state: ConnectionState): void {
		this.states.set(envId, state);
		for (const listener of this.listeners) {
			listener(envId, state);
		}
	}
}

class FakeActiveEnv implements ActiveEnvironmentPort {
	private readonly listeners = new Set<() => void>();
	constructor(public id: string | undefined) {}

	getActiveId(): string | undefined {
		return this.id;
	}

	onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Move the active pointer and notify — mimics EnvironmentService.setActive firing onDidChange. */
	setActive(id: string | undefined): void {
		this.id = id;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

describe('ActiveConnection', () => {
	it('getState reports disconnected when nothing is active', () => {
		const active = new ActiveConnection(new FakeConnections(), new FakeActiveEnv(undefined));

		expect(active.getState()).toEqual({ status: 'disconnected' });
	});

	it("getState resolves to the active environment's own connection state", () => {
		const connections = new FakeConnections();
		connections.states.set('a', { status: 'connected', envId: 'a' });
		connections.states.set('b', { status: 'error', envId: 'b', error: 'boom' });
		const active = new ActiveConnection(connections, new FakeActiveEnv('b'));

		expect(active.getState()).toEqual({ status: 'error', envId: 'b', error: 'boom' });
	});

	it('run delegates to the active environment id', async () => {
		const connections = new FakeConnections();
		connections.states.set('a', { status: 'connected', envId: 'a' });
		const active = new ActiveConnection(connections, new FakeActiveEnv('a'));

		await expect(active.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
	});

	it('run rejects when nothing is active', async () => {
		const active = new ActiveConnection(new FakeConnections(), new FakeActiveEnv(undefined));

		await expect(active.run(() => Promise.resolve('ok'))).rejects.toThrow(/Not connected/);
	});

	it("onDidChangeState fires on any connection change, re-resolved to the active env's state", () => {
		const connections = new FakeConnections();
		const activeEnv = new FakeActiveEnv('a');
		const active = new ActiveConnection(connections, activeEnv);
		const listener = vi.fn();
		active.onDidChangeState(listener);

		// A background environment's change still notifies — the listener re-reads whichever env is
		// active *now*, so a stale background update can't be mistaken for the active one's state.
		connections.emit('b', { status: 'connected', envId: 'b' });

		expect(listener).toHaveBeenCalledWith({ status: 'disconnected' }); // 'a' still has no state

		connections.emit('a', { status: 'connected', envId: 'a' });

		expect(listener).toHaveBeenLastCalledWith({ status: 'connected', envId: 'a' });
	});

	it('fires on an active-pointer move with no underlying connection change', () => {
		const connections = new FakeConnections();
		connections.states.set('a', { status: 'connected', envId: 'a' });
		connections.states.set('b', { status: 'connected', envId: 'b' });
		const activeEnv = new FakeActiveEnv('a');
		const active = new ActiveConnection(connections, activeEnv);
		const listener = vi.fn();
		active.onDidChangeState(listener);

		// Switching active between two already-connected envs emits no connection event, yet changes
		// what getState() returns — the seam must still notify.
		activeEnv.setActive('b');

		expect(listener).toHaveBeenLastCalledWith({ status: 'connected', envId: 'b' });
	});

	it('unsubscribes from both sources', () => {
		const connections = new FakeConnections();
		const activeEnv = new FakeActiveEnv('a');
		const active = new ActiveConnection(connections, activeEnv);
		const listener = vi.fn();
		const unsubscribe = active.onDidChangeState(listener);

		unsubscribe();
		connections.emit('a', { status: 'connected', envId: 'a' });
		activeEnv.setActive('b');

		expect(listener).not.toHaveBeenCalled();
	});
});
