/**
 * Production-Vault detection.
 * Used to flag Production connections in the UI (op-blocking enforcement is deferred). Kept
 * `vscode`-free and dependency-free so the rule is unit-testable in isolation.
 */

const DEV_PVM_DOMAINS = ['vaultdev.com', 'vaultpvm.com'] as const;

/** True when the DNS belongs to a Vault DEV or PVM domain (never treated as Production). */
export function isVaultDevOrPvmDomain(vaultDNS: string | undefined): boolean {
	if (!vaultDNS) {
		return false;
	}
	// Match on the domain suffix, not a bare substring: `includes("vaultdev.com")` would
	// misclassify a crafted host like `notvaultdev.com.example` or `vaultdev.com.weird.io`.
	const host = vaultDNS
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, '')
		.split('/')[0]
		.split(':')[0];
	return DEV_PVM_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * True when connected to a Production Vault: the domain type is PRODUCTION (case-insensitive) AND
 * the DNS is not a DEV/PVM domain. Domain type is absent without Domain Admin — treated as
 * non-Production.
 */
export function isProductionVault(
	domainType: string | undefined,
	vaultDNS: string | undefined,
): boolean {
	if (!domainType || domainType.toLowerCase() !== 'production') {
		return false;
	}
	return !isVaultDevOrPvmDomain(vaultDNS);
}
