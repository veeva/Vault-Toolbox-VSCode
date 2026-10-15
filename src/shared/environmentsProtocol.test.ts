import { describe, it, expect } from 'vitest';
import { AuthType } from '../core/models/environment';
import {
	isActiveEnvironmentConnected,
	type EnvironmentRow,
	type EnvironmentStatus,
} from './environmentsProtocol';

function row(overrides: Partial<EnvironmentRow>): EnvironmentRow {
	return {
		id: 'e1',
		label: 'Sandbox',
		vaultDNS: 'myco.veevavault.com',
		authType: AuthType.Basic,
		status: 'disconnected' as EnvironmentStatus,
		isActive: false,
		isProduction: false,
		...overrides,
	};
}

describe('isActiveEnvironmentConnected', () => {
	it('is false when there are no environments', () => {
		expect(isActiveEnvironmentConnected({ environments: [] })).toBe(false);
	});

	it('is true when the active environment is connected', () => {
		const environments = [row({ id: 'e1', isActive: true, status: 'connected' })];
		expect(isActiveEnvironmentConnected({ environments })).toBe(true);
	});

	it('is false when the active environment is not connected', () => {
		const environments = [row({ id: 'e1', isActive: true, status: 'connecting' })];
		expect(isActiveEnvironmentConnected({ environments })).toBe(false);
	});

	it('is false when a connected environment is not the active one', () => {
		const environments = [
			row({ id: 'e1', isActive: true, status: 'disconnected' }),
			row({ id: 'e2', isActive: false, status: 'connected' }),
		];
		expect(isActiveEnvironmentConnected({ environments })).toBe(false);
	});
});
