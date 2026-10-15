import { AuthType, type Environment } from '../../core/models/environment';
import { isInvalidSession } from '../../core/rest/errors';
import type { VaultClient } from '../../core/rest/vaultClient';
import type { AuthResult, DomainInfo, ToolboxFeatureArea } from '../../core/rest/types';
import type {
	ClientFactory,
	ConnectionInfo,
	ConnectionState,
	CredentialProvider,
	ConnectionSettings,
	ReauthHandler,
} from './types';

/** Every Vault API call connection lifecycle makes carries this tag (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-authentication';

export interface ConnectionManagerDeps {
	clientFactory: ClientFactory;
	credentials: CredentialProvider;
	settings: () => ConnectionSettings;
	reauth: ReauthHandler;
}

/** How many environments may be connected at once (see ADR 0004). */
const MAX_CONNECTED = 3;

interface LiveConnection {
	client: VaultClient;
	reauthInFlight?: Promise<boolean>;
}

/**
 * Owns every live Vault connection, keyed by environment id — up to {@link MAX_CONNECTED} at once
 * (see ADR 0004). For each: orchestrates connect (auth → discover version → validate → domain info)
 * and recovers expired sessions independently (silent re-auth for Basic, prompt otherwise). Contains
 * no `vscode` imports so the recovery policy is unit-testable.
 */
export class ConnectionManager {
	private readonly states = new Map<string, ConnectionState>();
	private readonly live = new Map<string, LiveConnection>();
	private readonly listeners = new Set<(envId: string, state: ConnectionState) => void>();

	constructor(private readonly deps: ConnectionManagerDeps) {}

	getConnectionState(envId: string): ConnectionState {
		return this.states.get(envId) ?? { status: 'disconnected' };
	}

	/** ids currently holding a live client (any status reachable via {@link run}). */
	getConnectedIds(): string[] {
		return [...this.live.keys()];
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

	async connect(env: Environment): Promise<ConnectionInfo> {
		if (!this.live.has(env.id) && this.live.size >= MAX_CONNECTED) {
			throw new Error(
				`Maximum of ${MAX_CONNECTED} connected environments reached — disconnect one first.`,
			);
		}
		this.setState(env.id, { status: 'connecting', envId: env.id });
		try {
			const { apiVersion } = this.deps.settings();
			const secret = await this.deps.credentials.get(env.id);
			const client = this.deps.clientFactory(env, {
				apiVersion: apiVersion || undefined,
				sessionId:
					env.authType !== AuthType.Basic && secret
						? toSessionHeader(env.authType, secret)
						: undefined,
			});

			const authVaultIds = await this.authenticate(client, env, secret);

			// INVARIANT: version discovery runs at EVERY connect, even when `apiVersion` is pinned in
			// settings. Background metadata (`SHOW`) calls must always hit the Vault's latest API version
			// (`client.latestApiVersion`), independently of the pinned version that drives user-issued
			// queries — so the discovery probe cannot be skipped for pinned users. Cost: one extra
			// `GET /api/` per connect for the minority who pin. `discoverLatestApiVersion` leaves a pinned
			// `client.apiVersion` untouched and only records `latestApiVersion`.
			await client.auth.discoverLatestApiVersion(REFERENCE_ID);
			const user = await client.auth.validateSessionUser(REFERENCE_ID);
			const domain = await this.tryRetrieveDomain(client);

			this.live.set(env.id, { client });
			const info: ConnectionInfo = {
				environment: env,
				apiVersion: client.apiVersion,
				latestApiVersion: client.latestApiVersion,
				vaultId: client.vaultId,
				vaultName: resolveVaultName(client, domain, authVaultIds),
				user,
				domain,
			};
			this.setState(env.id, { status: 'connected', envId: env.id, info });
			return info;
		} catch (e) {
			this.live.delete(env.id);
			this.setState(env.id, {
				status: 'error',
				envId: env.id,
				error: e instanceof Error ? e.message : String(e),
			});
			throw e;
		}
	}

	/**
	 * Perform the environment's auth handshake. Returns the Basic-auth response's vault list (used to
	 * resolve the Vault name without Domain Admin); undefined for Session-ID auth.
	 */
	private async authenticate(
		client: VaultClient,
		env: Environment,
		secret: string | undefined,
	): Promise<AuthResult['vaultIds'] | undefined> {
		if (env.authType === AuthType.Basic) {
			if (!env.username) {
				throw new Error('Basic auth requires a user name.');
			}
			if (!secret) {
				throw new Error('No stored password for this environment.');
			}
			return (await client.auth.authenticateBasic(env.username, secret, REFERENCE_ID)).vaultIds;
		}
		if (!secret) {
			throw new Error(
				env.authType === AuthType.ApiAccessToken
					? 'No stored API access token for this environment.'
					: 'No stored session ID for this environment.',
			);
		}
		client.auth.setSession(toSessionHeader(env.authType, secret));
		return undefined;
	}

	/** Domain info requires Domain Admin; degrade to undefined when it's forbidden. */
	private async tryRetrieveDomain(client: VaultClient): Promise<DomainInfo | undefined> {
		try {
			return await client.auth.retrieveDomainInformation(REFERENCE_ID);
		} catch {
			return undefined;
		}
	}

	disconnect(envId: string): void {
		this.live.delete(envId);
		this.setState(envId, { status: 'disconnected' });
	}

	/** Run a client call against `envId`'s connection, with one automatic session-expiry retry. */
	async run<T>(envId: string, fn: (client: VaultClient) => Promise<T>): Promise<T> {
		const live = this.live.get(envId);
		if (!live) {
			throw new Error('Not connected to a Vault.');
		}
		try {
			return await fn(live.client);
		} catch (e) {
			if (!isInvalidSession(e instanceof Error ? e : String(e))) {
				throw e;
			}
			const recovered = await this.recoverSession(envId, live);
			if (!recovered) {
				throw e;
			}
			return await fn(live.client);
		}
	}

	/** De-dupes concurrent recovery attempts per connection so only one re-auth happens at a time. */
	private recoverSession(envId: string, live: LiveConnection): Promise<boolean> {
		if (!live.reauthInFlight) {
			live.reauthInFlight = this.doRecover(envId, live).finally(() => {
				live.reauthInFlight = undefined;
			});
		}
		return live.reauthInFlight;
	}

	private async doRecover(envId: string, live: LiveConnection): Promise<boolean> {
		const info = this.states.get(envId)?.info;
		if (!info) {
			return false;
		}
		const env = info.environment;
		const stored = await this.deps.credentials.get(env.id);
		const client = live.client;

		// Silent re-auth: Basic with a stored password.
		if (env.authType === AuthType.Basic && env.username && stored) {
			try {
				await client.auth.authenticateBasic(env.username, stored, REFERENCE_ID);
				this.markRecovered(envId, live, info);
				return true;
			} catch {
				// fall through to prompt
			}
		}

		// Otherwise (Session-ID, no stored password, or silent re-auth failed) prompt the user.
		const outcome = await this.deps.reauth.onSessionExpired(env);
		if (!outcome) {
			return false;
		}
		try {
			if (outcome.sessionId) {
				client.auth.setSession(toSessionHeader(env.authType, outcome.sessionId));
				await client.auth.validateSessionUser(REFERENCE_ID);
				await this.deps.credentials.set(env.id, outcome.sessionId);
			} else if (outcome.password && env.username) {
				await client.auth.authenticateBasic(env.username, outcome.password, REFERENCE_ID);
				await this.deps.credentials.set(env.id, outcome.password);
			} else {
				return false;
			}
			this.markRecovered(envId, live, info);
			return true;
		} catch {
			return false;
		}
	}

	/** Restore "connected" status — unless `disconnect` tore this connection down while recovering. */
	private markRecovered(envId: string, live: LiveConnection, info: ConnectionInfo): void {
		if (this.live.get(envId) === live) {
			this.setState(envId, { status: 'connected', envId, info });
		}
	}
}

/** Session-ID auth sends the secret as-is; API Access Token auth sends it as a Bearer token. */
function toSessionHeader(authType: AuthType, secret: string): string {
	return authType === AuthType.ApiAccessToken ? `Bearer ${secret}` : secret;
}

/**
 * Prefer the Domain Admin-only per-Vault name (matches infoRows' "Vault Name" row); fall back to
 * the Basic-auth response's `vaultIds`, which any user gets.
 */
function resolveVaultName(
	client: VaultClient,
	domain: DomainInfo | undefined,
	authVaultIds: AuthResult['vaultIds'] | undefined,
): string | undefined {
	return (
		domain?.vaults.find((vault) => vault.id === client.vaultId)?.name ??
		authVaultIds?.find((vault) => vault.id === client.vaultId)?.name
	);
}
