import { describe, it, expect } from 'vitest';
import { buildInfoRows } from './infoRows';
import type { ConnectionInfo } from '../connection/types';
import { AuthType, createEnvironment } from '../../core/models/environment';

const env = createEnvironment({
	label: 'SB',
	vaultDNS: 'myco.veevavault.com',
	username: 'admin',
	authType: AuthType.Basic,
});

function info(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
	return { environment: env, apiVersion: 'v26.1', ...overrides };
}

const asMap = (rows: { label: string; value: string }[]): Record<string, string> =>
	Object.fromEntries(rows.map((row) => [row.label, row.value]));

describe('buildInfoRows', () => {
	it('fills Name, DNS, ID, Domain Type, and User from connection info', () => {
		const rows = buildInfoRows(
			info({
				vaultId: 1776,
				vaultName: 'PromoMats',
				user: { userName: 'admin@x.com' },
				domain: {
					domainName: 'veepharm',
					domainType: 'Sandbox',
					vaults: [
						{ id: 99, name: 'Other', applications: ['quality__v'] },
						{
							id: 1776,
							name: 'PromoMats',
							familyLabel: 'Commercial',
							applications: ['promomats__v', 'medcomms__v'],
						},
					],
				},
			}),
		);

		expect(asMap(rows)).toEqual({
			'Vault DNS': 'myco.veevavault.com',
			'Vault ID': '1776',
			'Vault Name': 'PromoMats',
			'Domain Type': 'Sandbox',
			User: 'admin@x.com',
		});
		expect(rows.map((row) => row.label)).toEqual([
			'Vault DNS',
			'Vault ID',
			'Vault Name',
			'Domain Type',
			'User',
		]);
	});

	it('degrades to DNS/ID/User when domain info is absent (non-Domain-Admin)', () => {
		const rows = buildInfoRows(info({ vaultId: 1776, user: { userName: 'admin@x.com' } }));

		expect(asMap(rows)).toEqual({
			'Vault DNS': 'myco.veevavault.com',
			'Vault ID': '1776',
			User: 'admin@x.com',
		});
	});

	it('still shows Vault Name (from the Basic-auth response) when domain info is absent', () => {
		const rows = buildInfoRows(info({ vaultId: 1776, vaultName: 'PromoMats' }));

		expect(asMap(rows)).toEqual({
			'Vault Name': 'PromoMats',
			'Vault DNS': 'myco.veevavault.com',
			'Vault ID': '1776',
		});
	});

	it('omits Vault Name when domain/basic-auth info does not provide it', () => {
		const rows = buildInfoRows(
			info({
				vaultId: 1776,
				domain: {
					domainType: 'Sandbox',
					vaults: [{ id: 99, name: 'Other', familyLabel: 'X', applications: ['quality__v'] }],
				},
			}),
		);

		expect(asMap(rows)).toEqual({
			'Vault DNS': 'myco.veevavault.com',
			'Vault ID': '1776',
			'Domain Type': 'Sandbox',
		});
	});

	it('always includes Vault DNS even with no user, id, or domain', () => {
		const rows = buildInfoRows(info());
		expect(asMap(rows)).toEqual({ 'Vault DNS': 'myco.veevavault.com' });
	});
});
