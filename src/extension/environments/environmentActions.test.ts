import { describe, it, expect, vi, beforeEach } from 'vitest';

// The actions are a thin vscode adapter over EnvironmentService; stub the notification/browser
// surface they wire, mirroring the pattern in deploySdkCode.test.ts.
vi.mock('vscode', () => ({
	ProgressLocation: { Notification: 15 },
	window: {
		withProgress: vi.fn((_opts: unknown, task: () => unknown) => task()),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	env: {
		openExternal: vi.fn(),
	},
	Uri: {
		parse: vi.fn((value: string) => ({ toString: () => value })),
	},
}));

import * as vscode from 'vscode';
import { createEnvironmentActions } from './environmentActions';
import { EnvironmentService } from './environmentService';
import { EnvironmentStore } from '../storage/environmentStore';
import { ActiveEnvironmentStore } from '../storage/activeEnvironmentStore';
import { CredentialStore } from '../storage/credentialStore';
import { MemKeyValueStore, MemSecretStore } from '../../test-support/memStores';
import { AuthType } from '../../core/models/environment';
import type { EnvironmentConnector } from './environmentService';
import type { ConnectionState } from '../connection/types';

/** A connector that reports every environment as disconnected; openVault doesn't need a live one. */
class StubConnector implements EnvironmentConnector {
	connect = vi.fn();
	disconnect = vi.fn();
	getConnectionState(): ConnectionState {
		return { status: 'disconnected' };
	}
	getConnectedIds(): string[] {
		return [];
	}
}

/** A connector whose `connect` resolves as if the Vault reported its own name. */
class ConnectingConnector extends StubConnector {
	constructor(private readonly vaultName: string | undefined) {
		super();
		this.connect = vi.fn(async (env) => ({
			environment: env,
			apiVersion: 'v26.1',
			vaultName: this.vaultName,
		}));
	}
}

function makeService(connection: EnvironmentConnector = new StubConnector()) {
	const kv = new MemKeyValueStore();
	const environments = new EnvironmentStore(kv);
	const active = new ActiveEnvironmentStore(kv);
	const credentials = new CredentialStore(new MemSecretStore());
	return new EnvironmentService({ environments, active, credentials, connection });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createEnvironmentActions openVault', () => {
	it('opens https://<vaultDNS>/ for the environment, built from the stored DNS (not webview input)', async () => {
		const service = makeService();
		const env = await service.add(
			{ label: 'Sandbox', vaultDNS: 'my-sandbox.veevavault.com', authType: AuthType.Basic },
			'secret',
		);
		const actions = createEnvironmentActions(service);

		await actions.openVault(env.id);

		expect(vscode.Uri.parse).toHaveBeenCalledWith('https://my-sandbox.veevavault.com/');
		expect(vscode.env.openExternal).toHaveBeenCalledOnce();
	});

	it('does nothing for an unknown environment id', async () => {
		const service = makeService();
		const actions = createEnvironmentActions(service);

		await actions.openVault('does-not-exist');

		expect(vscode.Uri.parse).not.toHaveBeenCalled();
		expect(vscode.env.openExternal).not.toHaveBeenCalled();
	});
});

describe('createEnvironmentActions connect', () => {
	it('reports the Vault-reported name, not the environment label', async () => {
		const service = makeService(new ConnectingConnector('Acme Sandbox (Vault)'));
		const env = await service.add(
			{ label: 'Sandbox', vaultDNS: 'my-sandbox.veevavault.com', authType: AuthType.Basic },
			'secret',
		);
		const actions = createEnvironmentActions(service);

		await actions.connect(env.id);

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'Vault Toolbox: Connected to Acme Sandbox (Vault)',
		);
	});

	it('falls back to the environment label when the Vault reports no name', async () => {
		const service = makeService(new ConnectingConnector(undefined));
		const env = await service.add(
			{ label: 'Sandbox', vaultDNS: 'my-sandbox.veevavault.com', authType: AuthType.Basic },
			'secret',
		);
		const actions = createEnvironmentActions(service);

		await actions.connect(env.id);

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Vault Toolbox: Connected to Sandbox');
	});
});
