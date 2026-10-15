import { describe, it, expect } from 'vitest';
import { ConnectionManager } from './connectionManager';
import type { ClientFactory, CredentialProvider, ReauthHandler } from './types';
import { AuthType, createEnvironment, type Environment } from '../../core/models/environment';
import { VaultClient } from '../../core/rest/vaultClient';
import type { HttpRequest, HttpTransport, VaultHttpResponse } from '../../core/rest/types';

const DNS = 'myco.veevavault.com';

function resp(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): VaultHttpResponse {
	const lower = new Map(
		Object.entries(headers).map(([headerName, value]) => [headerName.toLowerCase(), value]),
	);
	return { status, body, headers, getHeader: (headerName) => lower.get(headerName.toLowerCase()) };
}

const INVALID_SESSION = resp({
	responseStatus: 'FAILURE',
	errors: [{ type: 'INVALID_SESSION_ID', message: 'Invalid or expired session' }],
});

const AUTH_OK = {
	responseStatus: 'SUCCESS',
	sessionId: 'SESSION_FROM_AUTH',
	userId: 42,
	vaultId: 1776,
	vaultIds: [{ id: 1776, name: 'PromoMats', url: `https://${DNS}/api` }],
};
const VERSIONS = { responseStatus: 'SUCCESS', values: { 'v25.1': 'x', 'v26.1': 'x' } };
const USER_OK = {
	responseStatus: 'SUCCESS',
	users: [{ user: { id: 42, user_name__v: 'admin@x.com' } }],
};
const DOMAIN_OK = {
	responseStatus: 'SUCCESS',
	domain__v: {
		domain_name__v: 'veepharm',
		domain_type__v: 'Sandbox',
		vaults__v: [{ id: 1776, vault_name__v: 'PromoMats', vault_status__v: 'Active' }],
	},
};

class FakeTransport implements HttpTransport {
	constructor(private readonly handler: (req: HttpRequest) => VaultHttpResponse) {}
	send(req: HttpRequest): Promise<VaultHttpResponse> {
		return Promise.resolve(this.handler(req));
	}
}

class FakeCreds implements CredentialProvider {
	readonly map = new Map<string, string>();
	get(id: string): PromiseLike<string | undefined> {
		return Promise.resolve(this.map.get(id));
	}
	set(id: string, secret: string): PromiseLike<void> {
		this.map.set(id, secret);
		return Promise.resolve();
	}
}

class FakeReauth implements ReauthHandler {
	calls = 0;
	constructor(private readonly outcome: { password?: string; sessionId?: string } | undefined) {}
	async onSessionExpired(): Promise<{ password?: string; sessionId?: string } | undefined> {
		this.calls++;
		return this.outcome;
	}
}

function basicEnv(label = 'SB'): Environment {
	return createEnvironment({
		label,
		vaultDNS: DNS,
		username: 'admin',
		authType: AuthType.Basic,
	});
}
function sessionEnv(): Environment {
	return createEnvironment({ label: 'SB', vaultDNS: DNS, authType: AuthType.SessionId });
}

function build(
	transport: HttpTransport,
	creds: CredentialProvider,
	reauth: ReauthHandler,
): { manager: ConnectionManager; factoryCalls: Array<{ sessionId?: string }> } {
	const factoryCalls: Array<{ sessionId?: string }> = [];
	const clientFactory: ClientFactory = (env, opts) => {
		factoryCalls.push({ sessionId: opts.sessionId });
		return new VaultClient({
			vaultDNS: env.vaultDNS,
			transport,
			apiVersion: opts.apiVersion,
			sessionId: opts.sessionId,
		});
	};
	const manager = new ConnectionManager({
		clientFactory,
		credentials: creds,
		settings: () => ({ apiVersion: undefined }),
		reauth,
	});
	return { manager, factoryCalls };
}

describe('ConnectionManager.connect', () => {
	const route = (req: HttpRequest): VaultHttpResponse => {
		if (req.url.endsWith('/auth')) return resp(AUTH_OK);
		if (req.url === `https://${DNS}/api/`) return resp(VERSIONS);
		// Real Vault returns this header on every authenticated call, including for Session-ID auth,
		// which never hits /auth to learn vaultId any other way.
		if (req.url.includes('/objects/users/me'))
			return resp(USER_OK, 200, { 'X-VaultAPI-VaultId': '1776' });
		if (req.url.includes('/objects/domain')) return resp(DOMAIN_OK);
		return resp({ responseStatus: 'FAILURE', errors: [{ type: 'UNROUTED', message: req.url }] });
	};

	it('connects with Basic auth and populates Vault info', async () => {
		const creds = new FakeCreds();
		const env = basicEnv();
		creds.map.set(env.id, 'password');
		const { manager, factoryCalls } = build(
			new FakeTransport(route),
			creds,
			new FakeReauth(undefined),
		);

		const info = await manager.connect(env);

		expect(manager.getConnectionState(env.id).status).toBe('connected');
		expect(info.user?.userName).toBe('admin@x.com');
		expect(info.apiVersion).toBe('v26.1');
		expect(info.domain?.domainType).toBe('Sandbox');
		expect(info.vaultName).toBe('PromoMats');
		expect(factoryCalls[0].sessionId).toBeUndefined(); // Basic: no session passed to the client
	});

	it('runs version discovery even when apiVersion is pinned, storing latestApiVersion separately', async () => {
		let versionProbes = 0;
		const countingRoute = (req: HttpRequest): VaultHttpResponse => {
			if (req.url === `https://${DNS}/api/`) {
				versionProbes++;
			}
			return route(req);
		};
		const creds = new FakeCreds();
		const env = basicEnv();
		creds.map.set(env.id, 'password');
		const clientFactory: ClientFactory = (environment, opts) =>
			new VaultClient({
				vaultDNS: environment.vaultDNS,
				transport: new FakeTransport(countingRoute),
				apiVersion: opts.apiVersion,
				sessionId: opts.sessionId,
			});
		const manager = new ConnectionManager({
			clientFactory,
			credentials: creds,
			settings: () => ({ apiVersion: 'v25.1' }), // user pinned a version
			reauth: new FakeReauth(undefined),
		});

		const info = await manager.connect(env);

		expect(versionProbes).toBe(1); // the invariant: discovery still runs for pinned users
		expect(info.apiVersion).toBe('v25.1'); // user queries keep the pin
		expect(info.latestApiVersion).toBe('v26.1'); // SHOW metadata uses the discovered latest
	});

	it('connects with Session-ID auth using the stored token', async () => {
		const creds = new FakeCreds();
		const env = sessionEnv();
		creds.map.set(env.id, 'SESSIONID');
		const { manager, factoryCalls } = build(
			new FakeTransport(route),
			creds,
			new FakeReauth(undefined),
		);

		const info = await manager.connect(env);

		expect(manager.getConnectionState(env.id).status).toBe('connected');
		expect(info.user?.userName).toBe('admin@x.com');
		expect(info.vaultName).toBe('PromoMats'); // from domain info; Session-ID never calls /auth
		expect(factoryCalls[0].sessionId).toBe('SESSIONID');
	});

	it('errors when Basic auth has no stored password', async () => {
		const env = basicEnv();
		const { manager } = build(new FakeTransport(route), new FakeCreds(), new FakeReauth(undefined));

		await expect(manager.connect(env)).rejects.toThrow(/No stored password/);
		expect(manager.getConnectionState(env.id).status).toBe('error');
	});

	it('still connects when domain info is forbidden (non-Domain-Admin)', async () => {
		const creds = new FakeCreds();
		const env = basicEnv();
		creds.map.set(env.id, 'password');
		const routeNoDomain = (req: HttpRequest): VaultHttpResponse =>
			req.url.includes('/objects/domain')
				? resp({
						responseStatus: 'FAILURE',
						errors: [{ type: 'INSUFFICIENT_ACCESS', message: 'nope' }],
					})
				: route(req);
		const { manager } = build(new FakeTransport(routeNoDomain), creds, new FakeReauth(undefined));

		const info = await manager.connect(env);

		expect(manager.getConnectionState(env.id).status).toBe('connected');
		expect(info.domain).toBeUndefined();
		expect(info.vaultName).toBe('PromoMats'); // falls back to the Basic-auth response's vaultIds
	});

	it('has no Vault name for Session-ID auth without Domain Admin (no /auth call to fall back to)', async () => {
		const creds = new FakeCreds();
		const env = sessionEnv();
		creds.map.set(env.id, 'SESSIONID');
		const routeNoDomain = (req: HttpRequest): VaultHttpResponse =>
			req.url.includes('/objects/domain')
				? resp({
						responseStatus: 'FAILURE',
						errors: [{ type: 'INSUFFICIENT_ACCESS', message: 'nope' }],
					})
				: route(req);
		const { manager } = build(new FakeTransport(routeNoDomain), creds, new FakeReauth(undefined));

		const info = await manager.connect(env);

		expect(manager.getConnectionState(env.id).status).toBe('connected');
		expect(info.vaultName).toBeUndefined();
	});
});

describe('ConnectionManager.run — session expiry recovery', () => {
	it('silently re-authenticates Basic and retries, without prompting', async () => {
		let authCount = 0;
		const route = (req: HttpRequest): VaultHttpResponse => {
			if (req.url.endsWith('/auth')) {
				authCount++;
				return resp(AUTH_OK);
			}
			if (req.url === `https://${DNS}/api/`) return resp(VERSIONS);
			if (req.url.includes('/objects/users/me')) return resp(USER_OK);
			if (req.url.includes('/objects/domain')) return resp(DOMAIN_OK);
			if (req.url.includes('/keep-alive')) {
				return authCount >= 2 ? resp({ responseStatus: 'SUCCESS' }) : INVALID_SESSION;
			}
			return resp({ responseStatus: 'FAILURE', errors: [{ type: 'UNROUTED', message: req.url }] });
		};
		const creds = new FakeCreds();
		const env = basicEnv();
		creds.map.set(env.id, 'password');
		const reauth = new FakeReauth(undefined);
		const { manager } = build(new FakeTransport(route), creds, reauth);
		await manager.connect(env); // authCount === 1

		await expect(manager.run(env.id, (client) => client.auth.sessionKeepAlive('toolbox-authentication'))).resolves.toBeUndefined();

		expect(authCount).toBe(2); // one silent re-auth happened
		expect(reauth.calls).toBe(0); // no prompt for Basic
		expect(manager.getConnectionState(env.id).status).toBe('connected');
	});

	it('prompts for a new Session ID, persists it, and retries', async () => {
		const route = (req: HttpRequest): VaultHttpResponse => {
			if (req.url === `https://${DNS}/api/`) return resp(VERSIONS);
			if (req.url.includes('/objects/users/me')) return resp(USER_OK); // valid for any session
			if (req.url.includes('/objects/domain')) return resp(DOMAIN_OK);
			if (req.url.includes('/keep-alive')) {
				return req.headers?.['Authorization'] === 'NEW'
					? resp({ responseStatus: 'SUCCESS' })
					: INVALID_SESSION;
			}
			return resp({ responseStatus: 'FAILURE', errors: [{ type: 'UNROUTED', message: req.url }] });
		};
		const creds = new FakeCreds();
		const env = sessionEnv();
		creds.map.set(env.id, 'OLD');
		const reauth = new FakeReauth({ sessionId: 'NEW' });
		const { manager } = build(new FakeTransport(route), creds, reauth);
		await manager.connect(env);

		await expect(manager.run(env.id, (client) => client.auth.sessionKeepAlive('toolbox-authentication'))).resolves.toBeUndefined();

		expect(reauth.calls).toBe(1);
		expect(await creds.get(env.id)).toBe('NEW'); // refreshed token persisted
	});

	it('rejects with the original error when the user cancels the re-auth prompt', async () => {
		const route = (req: HttpRequest): VaultHttpResponse => {
			if (req.url === `https://${DNS}/api/`) return resp(VERSIONS);
			if (req.url.includes('/objects/users/me')) return resp(USER_OK);
			if (req.url.includes('/objects/domain')) return resp(DOMAIN_OK);
			if (req.url.includes('/keep-alive')) return INVALID_SESSION; // never recovers
			return resp({ responseStatus: 'FAILURE', errors: [{ type: 'UNROUTED', message: req.url }] });
		};
		const creds = new FakeCreds();
		const env = sessionEnv();
		creds.map.set(env.id, 'OLD');
		const reauth = new FakeReauth(undefined); // user dismisses the prompt
		const { manager } = build(new FakeTransport(route), creds, reauth);
		await manager.connect(env);

		await expect(manager.run(env.id, (client) => client.auth.sessionKeepAlive('toolbox-authentication'))).rejects.toThrow(
			/INVALID_SESSION_ID/,
		);
		expect(reauth.calls).toBe(1);
	});

	it('falls through to the prompt when silent Basic re-auth fails, then retries', async () => {
		let authCount = 0;
		const route = (req: HttpRequest): VaultHttpResponse => {
			if (req.url.endsWith('/auth')) {
				authCount++;
				// #1 initial connect succeeds; #2 silent re-auth fails; #3 prompt-supplied creds succeed.
				return authCount === 2
					? resp({
							responseStatus: 'FAILURE',
							errors: [{ type: 'USERNAME_OR_PASSWORD_INCORRECT', message: 'bad' }],
						})
					: resp(AUTH_OK);
			}
			if (req.url === `https://${DNS}/api/`) return resp(VERSIONS);
			if (req.url.includes('/objects/users/me')) return resp(USER_OK);
			if (req.url.includes('/objects/domain')) return resp(DOMAIN_OK);
			if (req.url.includes('/keep-alive'))
				return authCount >= 3 ? resp({ responseStatus: 'SUCCESS' }) : INVALID_SESSION;
			return resp({ responseStatus: 'FAILURE', errors: [{ type: 'UNROUTED', message: req.url }] });
		};
		const creds = new FakeCreds();
		const env = basicEnv();
		creds.map.set(env.id, 'password');
		const reauth = new FakeReauth({ password: 'GOODPW' });
		const { manager } = build(new FakeTransport(route), creds, reauth);
		await manager.connect(env); // authCount === 1

		await expect(manager.run(env.id, (client) => client.auth.sessionKeepAlive('toolbox-authentication'))).resolves.toBeUndefined();

		expect(reauth.calls).toBe(1); // silent re-auth failed, so the prompt was used
		expect(manager.getConnectionState(env.id).status).toBe('connected');
	});

	it('de-dupes concurrent recovery so it prompts only once', async () => {
		const route = (req: HttpRequest): VaultHttpResponse => {
			if (req.url === `https://${DNS}/api/`) return resp(VERSIONS);
			if (req.url.includes('/objects/users/me')) return resp(USER_OK);
			if (req.url.includes('/objects/domain')) return resp(DOMAIN_OK);
			if (req.url.includes('/keep-alive')) {
				return req.headers?.['Authorization'] === 'NEW'
					? resp({ responseStatus: 'SUCCESS' })
					: INVALID_SESSION;
			}
			return resp({ responseStatus: 'FAILURE', errors: [{ type: 'UNROUTED', message: req.url }] });
		};
		const creds = new FakeCreds();
		const env = sessionEnv();
		creds.map.set(env.id, 'OLD');
		const reauth = new FakeReauth({ sessionId: 'NEW' });
		const { manager } = build(new FakeTransport(route), creds, reauth);
		await manager.connect(env);

		const [a, b] = await Promise.all([
			manager.run(env.id, (client) => client.auth.sessionKeepAlive('toolbox-authentication')),
			manager.run(env.id, (client) => client.auth.sessionKeepAlive('toolbox-authentication')),
		]);

		expect(a).toBeUndefined();
		expect(b).toBeUndefined();
		expect(reauth.calls).toBe(1); // single in-flight recovery
	});
});

describe('ConnectionManager multi-environment', () => {
	const route = (req: HttpRequest): VaultHttpResponse => {
		if (req.url.endsWith('/auth')) return resp(AUTH_OK);
		if (req.url === `https://${DNS}/api/`) return resp(VERSIONS);
		if (req.url.includes('/objects/users/me')) return resp(USER_OK);
		if (req.url.includes('/objects/domain')) return resp(DOMAIN_OK);
		return resp({ responseStatus: 'FAILURE', errors: [{ type: 'UNROUTED', message: req.url }] });
	};

	function connectedEnv(creds: FakeCreds, label: string): Environment {
		const env = basicEnv(label);
		creds.map.set(env.id, 'password');
		return env;
	}

	it('keeps up to 3 environments connected simultaneously, independent of one another', async () => {
		const creds = new FakeCreds();
		const { manager } = build(new FakeTransport(route), creds, new FakeReauth(undefined));
		const daniels = connectedEnv(creds, 'Daniels');
		const omar = connectedEnv(creds, 'Omar');
		const kima = connectedEnv(creds, 'Kima');

		await manager.connect(daniels);
		await manager.connect(omar);
		await manager.connect(kima);

		expect(manager.getConnectionState(daniels.id).status).toBe('connected');
		expect(manager.getConnectionState(omar.id).status).toBe('connected');
		expect(manager.getConnectionState(kima.id).status).toBe('connected');
		expect(manager.getConnectedIds().sort()).toEqual([daniels.id, omar.id, kima.id].sort());
	});

	it('rejects a 4th simultaneous connection once the cap is reached', async () => {
		const creds = new FakeCreds();
		const { manager } = build(new FakeTransport(route), creds, new FakeReauth(undefined));
		const daniels = connectedEnv(creds, 'Daniels');
		const omar = connectedEnv(creds, 'Omar');
		const kima = connectedEnv(creds, 'Kima');
		const bunk = connectedEnv(creds, 'Bunk');
		await manager.connect(daniels);
		await manager.connect(omar);
		await manager.connect(kima);

		await expect(manager.connect(bunk)).rejects.toThrow(/Maximum of 3/);

		expect(manager.getConnectedIds()).toHaveLength(3);
		expect(manager.getConnectionState(bunk.id).status).toBe('disconnected');
	});

	it('allows reconnecting an already-connected environment at the cap (no net increase)', async () => {
		const creds = new FakeCreds();
		const { manager } = build(new FakeTransport(route), creds, new FakeReauth(undefined));
		const daniels = connectedEnv(creds, 'Daniels');
		const omar = connectedEnv(creds, 'Omar');
		const kima = connectedEnv(creds, 'Kima');
		await manager.connect(daniels);
		await manager.connect(omar);
		await manager.connect(kima);

		await expect(manager.connect(daniels)).resolves.toBeDefined();

		expect(manager.getConnectedIds()).toHaveLength(3);
	});

	it('disconnecting one environment does not affect another', async () => {
		const creds = new FakeCreds();
		const { manager } = build(new FakeTransport(route), creds, new FakeReauth(undefined));
		const daniels = connectedEnv(creds, 'Daniels');
		const omar = connectedEnv(creds, 'Omar');
		await manager.connect(daniels);
		await manager.connect(omar);

		manager.disconnect(daniels.id);

		expect(manager.getConnectionState(daniels.id).status).toBe('disconnected');
		expect(manager.getConnectionState(omar.id).status).toBe('connected');
		expect(manager.getConnectedIds()).toEqual([omar.id]);
	});

	it('frees a cap slot once a connection is disconnected', async () => {
		const creds = new FakeCreds();
		const { manager } = build(new FakeTransport(route), creds, new FakeReauth(undefined));
		const daniels = connectedEnv(creds, 'Daniels');
		const omar = connectedEnv(creds, 'Omar');
		const kima = connectedEnv(creds, 'Kima');
		const bunk = connectedEnv(creds, 'Bunk');
		await manager.connect(daniels);
		await manager.connect(omar);
		await manager.connect(kima);
		manager.disconnect(omar.id);

		await expect(manager.connect(bunk)).resolves.toBeDefined();

		expect(manager.getConnectedIds().sort()).toEqual([daniels.id, kima.id, bunk.id].sort());
	});
});
