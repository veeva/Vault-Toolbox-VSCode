import { describe, it, expect } from 'vitest';
import { AuthType, type Environment } from '../../core/models/environment';
import type { ConnectionState } from '../connection/types';
import { buildEnvironmentsSnapshot, type ConnectionStateLookup } from './environmentsSnapshot';

const SANDBOX: Environment = {
	id: 'e1',
	label: 'Sandbox',
	vaultDNS: 'myco.veevavault.com',
	authType: AuthType.Basic,
	username: 'admin',
};

const DISCONNECTED: ConnectionState = { status: 'disconnected' };

/** A fixed map of envId -> ConnectionState; unlisted ids default to disconnected. */
function lookup(states: Record<string, ConnectionState>): ConnectionStateLookup {
	return { getConnectionState: (envId) => states[envId] ?? DISCONNECTED };
}

describe('buildEnvironmentsSnapshot', () => {
	it('maps a saved environment with no live connection to a disconnected row', () => {
		const snapshot = buildEnvironmentsSnapshot([SANDBOX], lookup({}), undefined);

		expect(snapshot.environments).toEqual([
			{
				id: 'e1',
				label: 'Sandbox',
				vaultDNS: 'myco.veevavault.com',
				authType: AuthType.Basic,
				username: 'admin',
				status: 'disconnected',
				isActive: false,
				isProduction: false,
			},
		]);
	});

	it('flags the active environment', () => {
		const snapshot = buildEnvironmentsSnapshot([SANDBOX], lookup({}), 'e1');

		expect(snapshot.environments[0].isActive).toBe(true);
	});

	it('gives the connected environment a connected status with its info rows', () => {
		const connected: ConnectionState = {
			status: 'connected',
			envId: 'e1',
			info: { environment: SANDBOX, apiVersion: 'v26.1', vaultName: 'MyCo Sandbox' },
		};

		const row = buildEnvironmentsSnapshot([SANDBOX], lookup({ e1: connected }), 'e1').environments[0];

		expect(row.status).toBe('connected');
		expect(row.info).toEqual([
			{ label: 'Vault DNS', value: 'myco.veevavault.com' },
			{ label: 'Vault Name', value: 'MyCo Sandbox' },
		]);
	});

	it('leaves an unconnected environment disconnected even when another is connected', () => {
		const other: Environment = {
			...SANDBOX,
			id: 'e2',
			label: 'Prod',
			vaultDNS: 'prod.veevavault.com',
		};
		const connected: ConnectionState = {
			status: 'connected',
			envId: 'e1',
			info: { environment: SANDBOX, apiVersion: 'v26.1', vaultName: 'MyCo Sandbox' },
		};

		const rows = buildEnvironmentsSnapshot([SANDBOX, other], lookup({ e1: connected }), 'e1')
			.environments;

		expect(rows[1].status).toBe('disconnected');
		expect(rows[1].info).toBeUndefined();
	});

	it('shows multiple environments as connected at once, independently', () => {
		const other: Environment = {
			...SANDBOX,
			id: 'e2',
			label: 'Prod',
			vaultDNS: 'prod.veevavault.com',
		};
		const connectedE1: ConnectionState = {
			status: 'connected',
			envId: 'e1',
			info: { environment: SANDBOX, apiVersion: 'v26.1', vaultName: 'MyCo Sandbox' },
		};
		const connectedE2: ConnectionState = {
			status: 'connected',
			envId: 'e2',
			info: { environment: other, apiVersion: 'v26.1', vaultName: 'MyCo Prod' },
		};

		const rows = buildEnvironmentsSnapshot(
			[SANDBOX, other],
			lookup({ e1: connectedE1, e2: connectedE2 }),
			'e1', // only e1 is active — e2 is connected but in the background
		).environments;

		expect(rows[0]).toMatchObject({ status: 'connected', isActive: true });
		expect(rows[1]).toMatchObject({ status: 'connected', isActive: false });
	});

	it('flags a connected Production Vault', () => {
		const prod: Environment = { ...SANDBOX, vaultDNS: 'prod.veevavault.com' };
		const connected: ConnectionState = {
			status: 'connected',
			envId: 'e1',
			info: {
				environment: prod,
				apiVersion: 'v26.1',
				domain: { domainType: 'PRODUCTION', vaults: [] },
			},
		};

		const row = buildEnvironmentsSnapshot([prod], lookup({ e1: connected }), 'e1').environments[0];

		expect(row.isProduction).toBe(true);
	});

	it('surfaces the error message for an errored connection', () => {
		const errored: ConnectionState = { status: 'error', envId: 'e1', error: 'auth failed' };

		const row = buildEnvironmentsSnapshot([SANDBOX], lookup({ e1: errored }), 'e1').environments[0];

		expect(row.status).toBe('error');
		expect(row.error).toBe('auth failed');
	});
});
