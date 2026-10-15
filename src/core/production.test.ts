import { describe, it, expect } from 'vitest';
import { isProductionVault, isVaultDevOrPvmDomain } from './production';

describe('isVaultDevOrPvmDomain', () => {
	it('matches vaultdev.com and vaultpvm.com, case-insensitively', () => {
		expect(isVaultDevOrPvmDomain('myco.vaultdev.com')).toBe(true);
		expect(isVaultDevOrPvmDomain('MyCo.VaultPVM.com')).toBe(true);
		expect(isVaultDevOrPvmDomain('myco.veevavault.com')).toBe(false);
		expect(isVaultDevOrPvmDomain(undefined)).toBe(false);
	});

	it('matches the bare domain and strips scheme/path/port before checking', () => {
		expect(isVaultDevOrPvmDomain('vaultdev.com')).toBe(true);
		expect(isVaultDevOrPvmDomain('https://myco.vaultdev.com/api')).toBe(true);
		expect(isVaultDevOrPvmDomain('myco.vaultpvm.com:443')).toBe(true);
	});

	it('does not match a crafted host that merely contains the domain as a substring', () => {
		expect(isVaultDevOrPvmDomain('notvaultdev.com')).toBe(false);
		expect(isVaultDevOrPvmDomain('vaultdev.com.attacker.example')).toBe(false);
		expect(isVaultDevOrPvmDomain('myco.vaultdev.com.evil.io')).toBe(false);
	});
});

describe('isProductionVault', () => {
	it('is true only for PRODUCTION domain type on a non-DEV/PVM DNS', () => {
		expect(isProductionVault('PRODUCTION', 'myco.veevavault.com')).toBe(true);
		expect(isProductionVault('production', 'myco.veevavault.com')).toBe(true);
	});

	it('is false for sandbox / unknown / missing domain types', () => {
		expect(isProductionVault('Sandbox', 'myco.veevavault.com')).toBe(false);
		expect(isProductionVault(undefined, 'myco.veevavault.com')).toBe(false);
		expect(isProductionVault('', 'myco.veevavault.com')).toBe(false);
	});

	it('is false for a PRODUCTION domain type on a DEV/PVM DNS', () => {
		expect(isProductionVault('PRODUCTION', 'myco.vaultdev.com')).toBe(false);
		expect(isProductionVault('PRODUCTION', 'myco.vaultpvm.com')).toBe(false);
	});
});
