import type { VaultClient } from '../../core/rest/vaultClient';
import type { ConnectionState, ObservableConnection } from './types';

/** Per-environment connection state + queries; `ConnectionManager` satisfies it. */
export interface MultiConnectionPort {
	getConnectionState(envId: string): ConnectionState;
	run<T>(envId: string, fn: (client: VaultClient) => Promise<T>): Promise<T>;
	onDidChangeState(listener: (envId: string, state: ConnectionState) => void): () => void;
}

/**
 * The active-environment pointer as an observable: which id is active now, and a subscription that
 * fires whenever that pointer moves. `EnvironmentService` satisfies it (its `onDidChange`). Observing
 * the pointer — not just reading it — is what lets {@link ActiveConnection} treat "which env is
 * active" as part of the connection state it emits (see below).
 */
export interface ActiveEnvironmentPort {
	getActiveId(): string | undefined;
	onDidChange(listener: () => void): () => void;
}

/**
 * Adapts the multi-environment {@link MultiConnectionPort} plus the active-environment pointer into
 * the single-connection shape `MetadataService`/`VqlBus`/the status bar consume — each of those only
 * ever acts on "whichever environment is active right now" (see ADR 0004), never on a specific
 * connected-but-inactive environment.
 */
export class ActiveConnection implements ObservableConnection {
	constructor(
		private readonly connections: MultiConnectionPort,
		private readonly activeEnv: ActiveEnvironmentPort,
	) {}

	getState(): ConnectionState {
		const activeId = this.activeEnv.getActiveId();
		return activeId ? this.connections.getConnectionState(activeId) : { status: 'disconnected' };
	}

	run<T>(fn: (client: VaultClient) => Promise<T>): Promise<T> {
		const activeId = this.activeEnv.getActiveId();
		if (!activeId) {
			return Promise.reject(new Error('Not connected to a Vault.'));
		}
		return this.connections.run(activeId, fn);
	}

	/**
	 * `getState()` is a function of two inputs — the underlying connection state and the active
	 * pointer — so this fires on a change to *either*: any underlying connection change, and any
	 * active-pointer move (switching active between two connected envs emits no connection event, yet
	 * changes what `getState()` returns). Each fire re-reads whichever env is active now. Both sources
	 * are coarse and the re-read is cheap, so a spurious fire (an unrelated background env changing, an
	 * environment being renamed) simply re-emits an unchanged state — observers re-render idempotently.
	 */
	onDidChangeState(listener: (state: ConnectionState) => void): () => void {
		const unsubConnections = this.connections.onDidChangeState(() => listener(this.getState()));
		const unsubActive = this.activeEnv.onDidChange(() => listener(this.getState()));
		return () => {
			unsubConnections();
			unsubActive();
		};
	}
}
