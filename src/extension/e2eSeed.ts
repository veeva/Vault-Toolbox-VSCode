import * as vscode from 'vscode';
import { AuthType, type Environment } from '../core/models/environment';
import { ActiveEnvironmentStore } from './storage/activeEnvironmentStore';
import { CredentialStore } from './storage/credentialStore';
import { EnvironmentStore } from './storage/environmentStore';

/**
 * The environments the E2E tier connects against, one per journey. Each `vaultDNS` must equal the
 * host its journey's cassette was scrubbed to, so the URLs `VaultClient` builds match the recorded
 * requests. Session-ID auth needs no username and issues no auth POST — exactly the handshake shape
 * the cassettes recorded (version discovery → `users/me` → `domain`), even for journey 3, whose live
 * recording used Basic auth: the `/auth` POSTs were dropped when scrubbing, so replay must not send
 * one either.
 */
const E2E_ENVIRONMENTS: readonly Environment[] = [
	// Journey 1 (VQL → results → paginate) — the auto-active env the activation reconnect connects.
	{ id: 'e2e-sandbox', label: 'E2E Sandbox', vaultDNS: 'example.veevavault.com', authType: AuthType.SessionId },
	// Journey 2 (MDL deploy). `.vaultdev.com` keeps the Production guard off, matching the recording.
	{ id: 'e2e-mdl', label: 'E2E MDL Sandbox', vaultDNS: 'mdl-sandbox.vaultdev.com', authType: AuthType.SessionId },
	// Journey 3 (Compare Environments) holds two by-id connections at once — a distinct source/target.
	// `hasCustomLabel` keeps the seeded label stable across Compare's on-demand connect (which otherwise
	// adopts the Vault's reported name), so the journeys' teardown can disconnect them by that label.
	{ id: 'e2e-compare-source', label: 'E2E Compare Source', vaultDNS: 'compare-source.veevavault.com', authType: AuthType.SessionId, hasCustomLabel: true },
	{ id: 'e2e-compare-target', label: 'E2E Compare Target', vaultDNS: 'compare-target.veevavault.com', authType: AuthType.SessionId, hasCustomLabel: true },
	// Journey 4 (Compare SDK code) — a distinct source/target pair on their own hosts, so their cassette
	// entries never collide with Journey 3's in the merged replay pool.
	{ id: 'e2e-code-source', label: 'E2E Code Source', vaultDNS: 'code-compare-source.veevavault.com', authType: AuthType.SessionId, hasCustomLabel: true },
	{ id: 'e2e-code-target', label: 'E2E Code Target', vaultDNS: 'code-compare-target.veevavault.com', authType: AuthType.SessionId, hasCustomLabel: true },
];

/** The env the activation reconnect connects unprompted; the other journeys connect on demand. */
const E2E_ACTIVE_ID = 'e2e-sandbox';

/**
 * The stored secret is never validated under replay — {@link ReplayHttpTransport} matches on
 * method + url + body, ignoring the session header — so any non-empty value connects.
 */
const E2E_SESSION_ID = 'e2e-replay-session';

/**
 * Test-only, env-gated: when `VAULT_TOOLBOX_E2E_CASSETTE` is set (the E2E replay tier), seed every
 * {@link E2E_ENVIRONMENTS} entry into globalState + SecretStorage and mark {@link E2E_ACTIVE_ID}
 * active, so the activation auto-reconnect connects journey 1 against the replay backend with no UI
 * to drive; the MDL and Compare journeys connect their own envs on demand. A no-op in production,
 * where the env var is never set. Also a no-op while recording (`VAULT_TOOLBOX_E2E_RECORD` set): the
 * author connects a real sandbox through the UI, so the fake envs must not hijack the active slot.
 * Awaited before the reconnect so `getActiveId()` sees the seed.
 */
export async function maybeSeedE2eEnvironment(context: vscode.ExtensionContext): Promise<void> {
	if (!process.env.VAULT_TOOLBOX_E2E_CASSETTE || process.env.VAULT_TOOLBOX_E2E_RECORD) {
		return;
	}
	const environments = new EnvironmentStore(context.globalState);
	const credentials = new CredentialStore(context.secrets);
	for (const env of E2E_ENVIRONMENTS) {
		await environments.upsert(env);
		await credentials.set(env.id, E2E_SESSION_ID);
	}
	await new ActiveEnvironmentStore(context.workspaceState).set(E2E_ACTIVE_ID);
}
