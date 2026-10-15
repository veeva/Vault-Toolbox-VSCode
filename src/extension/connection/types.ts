import type { Environment } from '../../core/models/environment';
import type { VaultClient } from '../../core/rest/vaultClient';
import type { DomainInfo, VaultUser } from '../../core/rest/types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionInfo {
	environment: Environment;
	/** Version driving user-issued queries — the pinned setting, or the discovered latest when unpinned. */
	apiVersion: string;
	/** The Vault's latest supported version, discovered at every connect; SHOW metadata calls use this. */
	latestApiVersion?: string;
	vaultId?: number;
	/**
	 * The connected Vault's display name — from the Basic-auth response's `vaultIds` (any user) or,
	 * if that's unavailable (Session-ID auth) or absent, `domain.vaults` (Domain Admin only).
	 */
	vaultName?: string;
	user?: VaultUser;
	domain?: DomainInfo;
}

export interface ConnectionState {
	status: ConnectionStatus;
	/** The environment this state refers to. Set for every non-disconnected state. */
	envId?: string;
	info?: ConnectionInfo;
	error?: string;
}

/**
 * A live connection that runs client calls with automatic session recovery. `ActiveConnection`
 * satisfies it; consumers that only read connection state and run queries — the VQL bus and the
 * metadata cache — depend on this narrow view so they stay unit-testable with a fake.
 */
export interface RunnableConnection {
	getState(): ConnectionState;
	run<T>(fn: (client: VaultClient) => Promise<T>): Promise<T>;
}

/**
 * A {@link RunnableConnection} that also emits state-change notifications. `ActiveConnection`
 * satisfies it; the status bar and the shell host need to react to connection changes, whereas
 * `MetadataService`/`VqlBus` only ever pull state on demand — kept as a separate, wider interface so
 * their fakes don't need a no-op `onDidChangeState`.
 *
 * The notification fires on any change to what `getState()` would return — both underlying
 * connection changes and active-environment-pointer moves (switching active between two connected
 * environments changes the state with no connection event of its own). It may fire spuriously with
 * an unchanged state, so treat it as "re-read now", not "something definitely changed".
 */
export interface ObservableConnection extends RunnableConnection {
	onDidChangeState(listener: (state: ConnectionState) => void): () => void;
}

/** Read/write the secret (password or session ID) for an environment. CredentialStore satisfies this. */
export interface CredentialProvider {
	get(envId: string): PromiseLike<string | undefined>;
	set(envId: string, secret: string): PromiseLike<void>;
}

export interface ConnectionSettings {
	/** Empty/undefined => discover the latest version at connect time. */
	apiVersion?: string;
}

export type ClientFactory = (
	env: Environment,
	clientOptions: { apiVersion?: string; sessionId?: string },
) => VaultClient;

/** Surfaces re-auth UI when a session can't be silently recovered. */
export interface ReauthHandler {
	/** Return fresh credentials to retry with, or undefined to give up. */
	onSessionExpired(
		env: Environment,
	): Promise<{ password?: string; sessionId?: string } | undefined>;
}
