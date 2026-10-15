import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { AuthType, type Environment } from '../../core/models/environment';
import type { ApiHistorySink } from '../../core/rest/loggingHttpTransport';
import { LoggingHttpTransport } from '../../core/rest/loggingHttpTransport';
import { NodeHttpTransport } from '../../core/rest/nodeHttpTransport';
import {
	RecordingHttpTransport,
	ReplayHttpTransport,
	type CassetteEntry,
} from '../../core/rest/replayHttpTransport';
import type { HttpTransport } from '../../core/rest/types';
import { VaultClient } from '../../core/rest/vaultClient';
import { ConnectionManager } from '../connection/connectionManager';
import type { ClientFactory, ConnectionSettings, ReauthHandler } from '../connection/types';
import { CredentialStore } from '../storage/credentialStore';
import { getVaultToolboxSetting } from './vscodeSettings';

/**
 * Env-gated seam for the E2E tier, over the same {@link HttpTransport} interface the units already
 * prove:
 * - `VAULT_TOOLBOX_E2E_CASSETTE` set + `VAULT_TOOLBOX_E2E_RECORD` set → record live traffic to that
 *   path (author a cassette once against a sandbox Vault).
 * - `VAULT_TOOLBOX_E2E_CASSETTE` set alone → replay deterministically, no network. The path may be a
 *   single cassette file or a directory of them (the whole suite replays from one directory; each
 *   journey targets a distinct host, so their entries never collide in the merged pool).
 * - neither set → the real Node fetch transport, unchanged (production).
 */
function createBaseTransport(): HttpTransport {
	const cassettePath = process.env.VAULT_TOOLBOX_E2E_CASSETTE;
	if (!cassettePath) {
		return new NodeHttpTransport();
	}
	if (process.env.VAULT_TOOLBOX_E2E_RECORD) {
		return createRecordingTransport(cassettePath);
	}
	return new ReplayHttpTransport(loadCassetteEntries(cassettePath));
}

/** Reads a single cassette file, or every `*.json` cassette in a directory, into one entry pool. */
function loadCassetteEntries(cassettePath: string): CassetteEntry[] {
	const readFile = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as CassetteEntry[];
	if (!statSync(cassettePath).isDirectory()) {
		return readFile(cassettePath);
	}
	return readdirSync(cassettePath)
		.filter((name) => name.endsWith('.json'))
		.flatMap((name) => readFile(join(cassettePath, name)));
}

/**
 * The single record-session buffer, shared across every connection. `createClientFactory` builds a
 * fresh transport per connection, but a multi-environment journey (e.g. Compare) records two vaults
 * at once — so the buffer and its flush-on-exit handler must be process-wide, not per connection.
 * A per-connection buffer would register competing `exit` handlers that each overwrite the cassette,
 * keeping only the last connection's traffic.
 */
let recordingEntries: CassetteEntry[] | undefined;

/** Records live exchanges to the shared buffer and flushes the cassette to disk on host exit. */
function createRecordingTransport(cassettePath: string): HttpTransport {
	if (!recordingEntries) {
		const entries: CassetteEntry[] = [];
		recordingEntries = entries;
		process.once('exit', () => writeFileSync(cassettePath, JSON.stringify(entries, null, 2)));
	}
	const entries = recordingEntries;
	return new RecordingHttpTransport(new NodeHttpTransport(), { add: (entry) => entries.push(entry) });
}

/**
 * Builds a real VaultClient over Node fetch for each connection attempt, with every call recorded to
 * the API History `sink` via a {@link LoggingHttpTransport} tagged with this connection's environment.
 */
export function createClientFactory(sink: ApiHistorySink): ClientFactory {
	return (env, clientOptions) =>
		new VaultClient({
			vaultDNS: env.vaultDNS,
			transport: new LoggingHttpTransport(createBaseTransport(), {
				envId: env.id,
				envLabel: env.label,
				sink,
			}),
			apiVersion: clientOptions.apiVersion,
			sessionId: clientOptions.sessionId,
		});
}

export function readConnectionSettings(): ConnectionSettings {
	return {
		// See getVaultToolboxSetting for why this key is `APIVersion`, not camelCase.
		apiVersion: getVaultToolboxSetting<string>('APIVersion') || undefined,
	};
}

/** Surfaces re-auth UI when a session can't be recovered silently. */
export class VscodeReauthHandler implements ReauthHandler {
	async onSessionExpired(
		env: Environment,
	): Promise<{ password?: string; sessionId?: string } | undefined> {
		const choice = await vscode.window.showWarningMessage(
			`Vault session expired for "${env.label}".`,
			'Reconnect',
		);
		if (choice !== 'Reconnect') {
			return undefined;
		}
		if (env.authType === AuthType.Basic) {
			const password = await vscode.window.showInputBox({
				prompt: `Password for ${env.username}@${env.vaultDNS}`,
				password: true,
				ignoreFocusOut: true,
			});
			return password ? { password } : undefined;
		}
		const promptLabel =
			env.authType === AuthType.ApiAccessToken ? 'API access token' : 'session ID';
		const sessionId = await vscode.window.showInputBox({
			prompt: `New ${promptLabel} for ${env.vaultDNS}`,
			password: true,
			ignoreFocusOut: true,
		});
		return sessionId ? { sessionId } : undefined;
	}
}

export function buildConnectionManager(
	context: vscode.ExtensionContext,
	apiHistory: ApiHistorySink,
): ConnectionManager {
	return new ConnectionManager({
		clientFactory: createClientFactory(apiHistory),
		credentials: new CredentialStore(context.secrets),
		settings: readConnectionSettings,
		reauth: new VscodeReauthHandler(),
	});
}
