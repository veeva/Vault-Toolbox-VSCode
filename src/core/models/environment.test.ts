import { describe, expect, it } from 'vitest';
import { AuthType, createEnvironment, normalizeDns, updateEnvironment } from './environment';

describe('normalizeDns', () => {
	it('strips scheme + trailing slash and lowercases', () => {
		expect(normalizeDns('HTTPS://MyCo.veevavault.com/')).toBe('myco.veevavault.com');
	});

	it('trims surrounding whitespace', () => {
		expect(normalizeDns('  myco.veevavault.com  ')).toBe('myco.veevavault.com');
	});

	it('is idempotent', () => {
		const once = normalizeDns('HTTP://Host.example.com//');
		expect(normalizeDns(once)).toBe(once);
	});
});

describe('createEnvironment', () => {
	it('generates an id and normalizes the DNS', () => {
		const env = createEnvironment({
			label: 'Dev',
			vaultDNS: 'HTTPS://Dev.veevavault.com/',
			authType: AuthType.SessionId,
		});
		expect(env.id).toMatch(/[0-9a-f-]{36}/);
		expect(env.vaultDNS).toBe('dev.veevavault.com');
	});

	it('keeps the username for Basic auth', () => {
		const env = createEnvironment({
			label: 'Dev',
			vaultDNS: 'dev.veevavault.com',
			username: 'user@co',
			authType: AuthType.Basic,
		});
		expect(env.username).toBe('user@co');
	});

	it('drops a stray username for Session-ID auth', () => {
		const env = createEnvironment({
			label: 'Dev',
			vaultDNS: 'dev.veevavault.com',
			username: 'user@co',
			authType: AuthType.SessionId,
		});
		expect(env.username).toBeUndefined();
	});
});

describe('updateEnvironment', () => {
	it('preserves the id while re-shaping the fields', () => {
		const updated = updateEnvironment('env-1', {
			label: 'Prod',
			vaultDNS: 'HTTPS://Prod.veevavault.com/',
			authType: AuthType.SessionId,
		});
		expect(updated.id).toBe('env-1');
		expect(updated.vaultDNS).toBe('prod.veevavault.com');
	});

	it('drops a stray username for Session-ID auth', () => {
		const updated = updateEnvironment('env-1', {
			label: 'Prod',
			vaultDNS: 'prod.veevavault.com',
			username: 'leftover',
			authType: AuthType.SessionId,
		});
		expect(updated.username).toBeUndefined();
	});
});
