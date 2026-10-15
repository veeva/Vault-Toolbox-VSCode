import { describe, it, expect, vi, beforeEach } from 'vitest';

// The status bar is a thin vscode adapter over a StatusBarItem; stub just the surface it uses,
// mirroring the pattern in environmentActions.test.ts.
vi.mock('vscode', () => ({
	StatusBarAlignment: { Left: 1 },
	ThemeColor: class ThemeColor {
		constructor(public id: string) {}
	},
	window: {
		createStatusBarItem: vi.fn(() => ({
			text: '',
			tooltip: '',
			color: undefined,
			backgroundColor: undefined,
			command: undefined,
			show: vi.fn(),
			dispose: vi.fn(),
		})),
	},
}));

import { EnvironmentStatusBar } from './environmentStatusBar';
import { EnvironmentService, type EnvironmentConnector } from '../environments/environmentService';
import { EnvironmentStore } from '../storage/environmentStore';
import { ActiveEnvironmentStore } from '../storage/activeEnvironmentStore';
import { CredentialStore } from '../storage/credentialStore';
import { MemKeyValueStore, MemSecretStore } from '../../test-support/memStores';
import { AuthType, type Environment } from '../../core/models/environment';
import type { ConnectionState, ObservableConnection } from '../connection/types';

/** A connection whose state is set directly by the test and whose listeners fire on demand — the
 * status bar reacts to `onDidChangeState`, not to how the state came to change. */
class FakeConnection implements ObservableConnection {
	private state: ConnectionState = { status: 'disconnected' };
	private readonly listeners = new Set<(state: ConnectionState) => void>();

	setState(state: ConnectionState): void {
		this.state = state;
		for (const listener of this.listeners) {
			listener(state);
		}
	}

	getState(): ConnectionState {
		return this.state;
	}

	run<T>(): Promise<T> {
		return Promise.reject(new Error('not used in these tests'));
	}

	onDidChangeState(listener: (state: ConnectionState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

/** Real EnvironmentService over in-memory stores; connection state is driven separately by
 * FakeConnection since the status bar only reads the environment (label/DNS), never connects
 * through this service. */
function makeService() {
	const kv = new MemKeyValueStore();
	const environments = new EnvironmentStore(kv);
	const active = new ActiveEnvironmentStore(kv);
	const credentials = new CredentialStore(new MemSecretStore());
	const connection: EnvironmentConnector = {
		connect: vi.fn(async (env) => ({ environment: env, apiVersion: 'v26.1' })),
		disconnect: vi.fn(),
		getConnectionState: () => ({ status: 'disconnected' }),
		getConnectedIds: () => [],
	};
	return { service: new EnvironmentService({ environments, active, credentials, connection }), active };
}

/** Adds an environment and marks it active directly via the store — bypassing
 * `EnvironmentService.setActive`'s "must already be connected" invariant, which doesn't apply
 * here: the status bar's job is to render whatever `ObservableConnection.getState()` says about
 * the active environment, independent of how it became active. */
async function addActiveEnvironment(
	service: EnvironmentService,
	active: ActiveEnvironmentStore,
): Promise<Environment> {
	const env = await service.add(
		{
			label: 'Acme Sandbox',
			vaultDNS: 'acme.veevavault.com',
			username: 'admin',
			authType: AuthType.Basic,
		},
		'hunter2',
	);
	await active.set(env.id);
	return env;
}

describe('EnvironmentStatusBar', () => {
	let service: EnvironmentService;
	let active: ActiveEnvironmentStore;
	let connection: FakeConnection;
	let env: Environment;

	beforeEach(async () => {
		const made = makeService();
		service = made.service;
		active = made.active;
		env = await addActiveEnvironment(service, active);
		connection = new FakeConnection();
	});

	function itemOf(bar: EnvironmentStatusBar) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (bar as any).item as { text: string; tooltip: string };
	}

	it('shows the neutral label with no environment active', () => {
		const { service: emptyService } = makeService();
		const bar = new EnvironmentStatusBar(emptyService, connection);

		expect(itemOf(bar).text).toBe('$(device-desktop) Vault Toolbox');
		expect(itemOf(bar).tooltip).toBe('Open Vault Toolbox');
	});

	it('shows the neutral label, never the Vault name, while a connect attempt is in flight', () => {
		connection.setState({ status: 'connecting', envId: env.id });
		const bar = new EnvironmentStatusBar(service, connection);

		expect(itemOf(bar).text).toBe('$(device-desktop) Vault Toolbox');
		expect(itemOf(bar).tooltip).toBe(`Connecting to ${env.label} (${env.vaultDNS})…`);
	});

	it('shows the neutral label, never the Vault name, after a failed connect attempt', () => {
		const bar = new EnvironmentStatusBar(service, connection);

		connection.setState({
			status: 'error',
			envId: env.id,
			error: 'INVALID_SESSION_ID: Invalid or expired session ID',
		});

		expect(itemOf(bar).text).toBe('$(device-desktop) Vault Toolbox');
		expect(itemOf(bar).tooltip).toBe(
			`${env.label} (${env.vaultDNS})\nConnection failed: INVALID_SESSION_ID: Invalid or expired session ID`,
		);
	});

	it('shows the Vault name only once actually connected', () => {
		const bar = new EnvironmentStatusBar(service, connection);

		connection.setState({
			status: 'connected',
			envId: env.id,
			info: { environment: env, apiVersion: 'v26.1' },
		});

		expect(itemOf(bar).text).toBe(`$(device-desktop) ${env.label}`);
		expect(itemOf(bar).tooltip).toContain(env.label);
	});

	it('flashes a check icon when switching to a different connected environment, then reverts', async () => {
		vi.useFakeTimers();
		try {
			const bar = new EnvironmentStatusBar(service, connection);
			connection.setState({
				status: 'connected',
				envId: env.id,
				info: { environment: env, apiVersion: 'v26.1' },
			});
			expect(itemOf(bar).text).toBe(`$(device-desktop) ${env.label}`);

			const other = await service.add(
				{
					label: 'Other Sandbox',
					vaultDNS: 'other.veevavault.com',
					username: 'admin',
					authType: AuthType.Basic,
				},
				'hunter2',
			);
			await active.set(other.id);
			connection.setState({
				status: 'connected',
				envId: other.id,
				info: { environment: other, apiVersion: 'v26.1' },
			});

			expect(itemOf(bar).text).toBe(`$(check) ${other.label}`);

			vi.advanceTimersByTime(2000);

			expect(itemOf(bar).text).toBe(`$(device-desktop) ${other.label}`);
		} finally {
			vi.useRealTimers();
		}
	});

	it('flashes when the active pointer alone moves to an already-connected background environment', async () => {
		vi.useFakeTimers();
		try {
			const bar = new EnvironmentStatusBar(service, connection);
			connection.setState({
				status: 'connected',
				envId: env.id,
				info: { environment: env, apiVersion: 'v26.1' },
			});
			expect(itemOf(bar).text).toBe(`$(device-desktop) ${env.label}`);

			const other = await service.add(
				{
					label: 'Other Sandbox',
					vaultDNS: 'other.veevavault.com',
					username: 'admin',
					authType: AuthType.Basic,
				},
				'hunter2',
			);
			// `other` is already connected in the background from the status bar's point of view —
			// the ObservableConnection already reports it connected before the active pointer moves,
			// mirroring setActive() picking an already-connected environment.
			connection.setState({
				status: 'connected',
				envId: other.id,
				info: { environment: other, apiVersion: 'v26.1' },
			});
			expect(itemOf(bar).text).toBe(`$(device-desktop) ${env.label}`);

			// Moves the active pointer and fires `service.onDidChange` (the store itself has no event
			// of its own — `service.connect` is the only available trigger here).
			await service.connect(other.id, { makeActive: true });

			expect(itemOf(bar).text).toBe(`$(check) ${other.label}`);

			vi.advanceTimersByTime(2000);

			expect(itemOf(bar).text).toBe(`$(device-desktop) ${other.label}`);
		} finally {
			vi.useRealTimers();
		}
	});

	it('reverts to the neutral label if a previously connected session later errors', () => {
		const bar = new EnvironmentStatusBar(service, connection);
		connection.setState({
			status: 'connected',
			envId: env.id,
			info: { environment: env, apiVersion: 'v26.1' },
		});
		expect(itemOf(bar).text).toBe(`$(device-desktop) ${env.label}`);

		connection.setState({ status: 'error', envId: env.id, error: 'INVALID_SESSION_ID' });

		expect(itemOf(bar).text).toBe('$(device-desktop) Vault Toolbox');
	});
});
