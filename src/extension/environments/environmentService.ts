import {
	AuthType,
	createEnvironment,
	updateEnvironment,
	type Environment,
} from '../../core/models/environment';
import type { ConnectionInfo, ConnectionState } from '../connection/types';
import type { CredentialStore } from '../storage/credentialStore';
import type { EnvironmentStore } from '../storage/environmentStore';
import type { ActiveEnvironmentStore } from '../storage/activeEnvironmentStore';

/** Non-secret fields collected when adding or editing an Environment. */
export interface EnvironmentInput {
	label: string;
	/** When true, suppresses the auto-adopt-on-connect behaviour (see {@link Environment.hasCustomLabel}). */
	hasCustomLabel?: boolean;
	vaultDNS: string;
	username?: string;
	authType: AuthType;
}

/** Narrow view of ConnectionManager the service needs, so tests can inject a fake. */
export interface EnvironmentConnector {
	connect(env: Environment): Promise<ConnectionInfo>;
	disconnect(envId: string): void;
	getConnectionState(envId: string): ConnectionState;
	getConnectedIds(): string[];
}

export interface EnvironmentServiceDeps {
	environments: EnvironmentStore;
	active: ActiveEnvironmentStore;
	credentials: CredentialStore;
	connection: EnvironmentConnector;
}

/**
 * Coordinates the environment stores, secrets, and the live connection behind the CRUD
 * commands. Framework-agnostic (no `vscode` imports) so the round-trip behaviour — secrets
 * cleared on remove, active/connection reset when the target disappears — is unit-testable.
 */
export class EnvironmentService {
	private readonly listeners = new Set<() => void>();

	constructor(private readonly deps: EnvironmentServiceDeps) {}

	/** Fires after any change to the environment list or active pointer. Framework-agnostic. */
	onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emitChange(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	list(): Environment[] {
		return this.deps.environments.list();
	}

	get(id: string): Environment | undefined {
		return this.deps.environments.get(id);
	}

	getActiveId(): string | undefined {
		return this.deps.active.get();
	}

	isConnected(id: string): boolean {
		return this.deps.connection.getConnectionState(id).status === 'connected';
	}

	/** Returns the Vault's reported display name when the environment is currently connected; undefined otherwise. */
	getConnectedVaultName(id: string): string | undefined {
		return this.deps.connection.getConnectionState(id).info?.vaultName;
	}

	/** Create a new Environment, persist it, and store its secret. Returns the created record. */
	async add(input: EnvironmentInput, secret: string): Promise<Environment> {
		const env = createEnvironment(input);
		await this.deps.environments.upsert(env);
		await this.deps.credentials.set(env.id, secret);
		this.emitChange();
		return env;
	}

	/**
	 * Update an existing Environment's non-secret fields (id preserved). When `secret` is
	 * provided it replaces the stored one; when omitted the existing secret is kept.
	 */
	async edit(id: string, input: EnvironmentInput, secret?: string): Promise<Environment> {
		const existing = this.deps.environments.get(id);
		if (!existing) {
			throw new Error(`Unknown environment: ${id}`);
		}
		const updated = updateEnvironment(existing.id, input);
		await this.deps.environments.upsert(updated);
		if (secret !== undefined) {
			await this.deps.credentials.set(updated.id, secret);
		}
		this.emitChange();
		return updated;
	}

	/**
	 * Delete an Environment and its secret. If it was connected that connection is dropped, and if
	 * it was the active environment the active pointer is cleared.
	 */
	async remove(id: string): Promise<void> {
		if (this.deps.connection.getConnectedIds().includes(id)) {
			this.deps.connection.disconnect(id);
		}
		if (this.deps.active.get() === id) {
			await this.deps.active.clear();
		}
		await this.deps.environments.remove(id);
		await this.deps.credentials.delete(id);
		this.emitChange();
	}

	/**
	 * Mark an existing, currently-connected Environment as the active target for this workspace.
	 * Active must always refer to a connected environment (see ADR 0004) — connect it first.
	 */
	async setActive(id: string): Promise<void> {
		const env = this.deps.environments.get(id);
		if (!env) {
			throw new Error(`Unknown environment: ${id}`);
		}
		if (!this.isConnected(id)) {
			throw new Error(`"${env.label}" is not connected — connect it first.`);
		}
		await this.deps.active.set(id);
		this.emitChange();
	}

	/**
	 * Connect to an Environment (see ADR 0004 for the cap on simultaneously-connected
	 * environments). By default this only bootstraps active when nothing is active yet — connecting
	 * a second or later environment never steals active status from another. Pass `makeActive: true`
	 * for a manual, user-driven connect (see ADR 0004): it should always take over active, even from
	 * an already-active environment. Compare Environments connects on demand behind the scenes and
	 * must never do this — it passes `makeActive: false` so the comparison's source/target never
	 * steals active status. Once the Vault reports its own name, adopt it as the label (replacing the
	 * DNS placeholder seeded on add) — unless the user set a custom label, in which case leave it.
	 */
	async connect(id: string, options?: { makeActive?: boolean }): Promise<ConnectionInfo> {
		const env = this.deps.environments.get(id);
		if (!env) {
			throw new Error(`Unknown environment: ${id}`);
		}
		const info = await this.deps.connection.connect(env);
		let changed = false;
		const makeActive = options?.makeActive ?? !this.deps.active.get();
		if (makeActive && this.deps.active.get() !== id) {
			await this.deps.active.set(id);
			changed = true;
		}
		if (info.vaultName && info.vaultName !== env.label && !env.hasCustomLabel) {
			await this.deps.environments.upsert({ ...env, label: info.vaultName });
			changed = true;
		}
		// The connection's own 'connected' event already fired (synchronously) inside connect() —
		// before the active pointer moved — so active-scoped observers (the VQL editor's connection
		// state) saw the stale pointer. Emitting here lets them re-read now that active is set.
		if (changed) {
			this.emitChange();
		}
		return info;
	}

	/**
	 * Disconnect a specific Environment. If it was active and another Environment is still
	 * connected, that one becomes active (see ADR 0004); otherwise active is cleared.
	 */
	async disconnect(id: string): Promise<void> {
		this.deps.connection.disconnect(id);
		if (this.deps.active.get() === id) {
			const [fallbackId] = this.deps.connection.getConnectedIds();
			if (fallbackId) {
				await this.deps.active.set(fallbackId);
			} else {
				await this.deps.active.clear();
			}
			this.emitChange();
		}
	}
}
