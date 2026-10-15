import type { ConnectionInfo } from '../connection/types';
import type { InfoRow } from '../../shared/environmentsProtocol';

export type { InfoRow };

/**
 * Build the connected-Vault info rows shown under an expanded environment node (Vault DNS, Vault ID,
 * Vault Name, Domain Type, User). Any empty value is omitted rather than shown blank; Vault DNS is always present.
 */
export function buildInfoRows(info: ConnectionInfo): InfoRow[] {
	const candidates: InfoRow[] = [
		{ label: 'Vault DNS', value: info.environment.vaultDNS },
		{ label: 'Vault ID', value: info.vaultId !== undefined ? String(info.vaultId) : '' },
		{ label: 'Vault Name', value: info.vaultName ?? '' },
		{ label: 'Domain Type', value: info.domain?.domainType ?? '' },
		{ label: 'User', value: info.user?.userName ?? '' },
	];

	return candidates.filter((row) => row.value !== '');
}
