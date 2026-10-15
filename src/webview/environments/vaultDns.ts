/** The shared Vault DNS suffix stripped from a `vaultDNS` for compact display (`myvault.veevavault.com` → `myvault`). */
const VAULT_DNS_SUFFIX = '.veevavault.com';

/** A `vaultDNS` shortened for display by dropping the common `.veevavault.com` suffix. */
export function shortVaultDns(dns: string): string {
	return dns.replace(VAULT_DNS_SUFFIX, '');
}
