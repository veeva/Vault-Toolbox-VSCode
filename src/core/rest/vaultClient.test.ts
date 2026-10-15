import { describe, it, expect } from 'vitest';
import { VaultClient, pickLatestApiVersion, DEFAULT_BOOTSTRAP_API_VERSION } from './vaultClient';
import { isInvalidSession, VaultApiError } from './errors';
import type { HttpRequest, HttpTransport, VaultHttpResponse } from './types';

const HEADER_REFERENCE_ID = 'X-VaultAPI-ReferenceID';

function resp(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): VaultHttpResponse {
	const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
	return { status, body, headers, getHeader: (name) => lower.get(name.toLowerCase()) };
}

class FakeTransport implements HttpTransport {
	readonly requests: HttpRequest[] = [];
	constructor(private readonly handler: (req: HttpRequest) => VaultHttpResponse) {}
	send(req: HttpRequest): Promise<VaultHttpResponse> {
		this.requests.push(req);
		return Promise.resolve(this.handler(req));
	}
}

const DNS = 'myco.veevavault.com';

describe('pickLatestApiVersion', () => {
	it('returns the highest vMAJOR.MINOR, ignoring unparseable keys', () => {
		const latest = pickLatestApiVersion({
			'v9.0': 'x',
			'v10.0': 'x',
			'v26.1': 'x',
			'v25.2': 'x',
			beta: 'x',
		});
		expect(latest).toBe('v26.1');
	});

	it('throws when no keys are recognizable versions', () => {
		expect(() => pickLatestApiVersion({})).toThrow(/No recognizable API versions/);
		expect(() => pickLatestApiVersion({ beta: 'x', latest: 'x' })).toThrow(
			/No recognizable API versions/,
		);
	});
});

describe('VaultClient.discoverLatestApiVersion', () => {
	it('switches an unpinned apiVersion to the latest, records latestApiVersion, and sends the session header', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', values: { 'v25.1': 'x', 'v26.1': 'x' } }),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		const latest = await client.auth.discoverLatestApiVersion('toolbox-authentication');

		expect(latest).toBe('v26.1');
		expect(client.apiVersion).toBe('v26.1');
		expect(client.latestApiVersion).toBe('v26.1');
		expect(transport.requests[0].url).toBe(`https://${DNS}/api/`);
		expect(transport.requests[0].headers?.['Authorization']).toBe('SESS');
	});

	it('records latestApiVersion but leaves a pinned apiVersion untouched', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', values: { 'v25.1': 'x', 'v26.1': 'x' } }),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v25.1', // pinned by the user in settings
		});

		const latest = await client.auth.discoverLatestApiVersion('toolbox-authentication');

		expect(latest).toBe('v26.1');
		expect(client.latestApiVersion).toBe('v26.1'); // SHOW calls use this
		expect(client.apiVersion).toBe('v25.1'); // user queries keep the pin
	});

	it('throws when the response carries no versions object', async () => {
		const transport = new FakeTransport(() => resp({ responseStatus: 'SUCCESS' }));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(client.auth.discoverLatestApiVersion('toolbox-authentication')).rejects.toThrow(/No API versions returned/);
	});

	it("throws 'Unexpected response' when the body is not a Vault envelope", async () => {
		const transport = new FakeTransport(() => resp('<html>gateway error</html>', 502));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(client.auth.discoverLatestApiVersion('toolbox-authentication')).rejects.toThrow(
			/Unexpected response \(HTTP 502\)/,
		);
	});
});

describe('VaultClient.authenticateBasic', () => {
	const okAuth = {
		responseStatus: 'SUCCESS',
		sessionId: 'NEW_SESSION',
		userId: 42,
		vaultId: 1776,
		vaultIds: [{ id: 1776, name: 'PromoMats', url: `https://${DNS}/api` }],
	};

	it('authenticates, stores the session, and hits the bootstrap version', async () => {
		const transport = new FakeTransport(() => resp(okAuth));
		const client = new VaultClient({ vaultDNS: DNS, transport });

		const result = await client.auth.authenticateBasic('admin', 'pw', 'toolbox-authentication');

		expect(result.sessionId).toBe('NEW_SESSION');
		expect(client.sessionId).toBe('NEW_SESSION');
		expect(client.vaultId).toBe(1776);
		expect(transport.requests[0].url).toBe(
			`https://${DNS}/api/${DEFAULT_BOOTSTRAP_API_VERSION}/auth`,
		);
		expect(transport.requests[0].method).toBe('POST');
	});

	it('rejects auth-defaulting to a different Vault (DNS mismatch)', async () => {
		const transport = new FakeTransport(() =>
			resp({
				...okAuth,
				vaultIds: [{ id: 1776, name: 'Other', url: 'https://other.veevavault.com/api' }],
			}),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport });

		await expect(client.auth.authenticateBasic('admin', 'pw', 'toolbox-authentication')).rejects.toMatchObject({
			type: 'VAULT_DNS_MISMATCH',
		});
	});

	it('fails closed when the authenticated Vault id is absent from the returned list', async () => {
		// vaultId 1776 authenticated, but the (non-empty) vault list doesn't contain it — we can't
		// confirm we reached the requested DNS, so the guard must reject rather than silently pass.
		const transport = new FakeTransport(() =>
			resp({ ...okAuth, vaultIds: [{ id: 4242, name: 'Elsewhere', url: `https://${DNS}/api` }] }),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport });

		await expect(client.auth.authenticateBasic('admin', 'pw', 'toolbox-authentication')).rejects.toMatchObject({
			type: 'VAULT_DNS_MISMATCH',
		});
	});

	it('throws with the Vault error type on a FAILURE envelope', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'USERNAME_OR_PASSWORD_INCORRECT', message: 'bad creds' }],
			}),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport });

		await expect(client.auth.authenticateBasic('admin', 'wrong', 'toolbox-authentication')).rejects.toThrow(
			/USERNAME_OR_PASSWORD_INCORRECT/,
		);
	});
});

describe('VaultClient.validateSessionUser', () => {
	it('parses the user and reads the Vault id header', async () => {
		const transport = new FakeTransport(() =>
			resp(
				{
					responseStatus: 'SUCCESS',
					users: [
						{ user: { id: 61603, user_name__v: 'tibanez@veepharm.com', user_email__v: 't@x.com' } },
					],
				},
				200,
				{ 'X-VaultAPI-VaultId': '1776' },
			),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const user = await client.auth.validateSessionUser('toolbox-authentication');

		expect(user.userName).toBe('tibanez@veepharm.com');
		expect(user.vaultId).toBe(1776);
		expect(transport.requests[0].url).toBe(`https://${DNS}/api/v26.1/objects/users/me`);
	});

	it('throws a detectable INVALID_SESSION_ID error', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'Invalid or expired' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'STALE',
			apiVersion: 'v26.1',
		});

		const err = await client.auth.validateSessionUser('toolbox-authentication').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(VaultApiError);
		expect(isInvalidSession(err as Error)).toBe(true);
	});
});

describe('VaultClient.retrieveDomainInformation', () => {
	it('maps domain and vaults', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				domain__v: {
					domain_name__v: 'veepharm',
					domain_type__v: 'Sandbox',
					vaults__v: [
						{
							id: 19523,
							vault_name__v: 'PromoMats',
							vault_status__v: 'Active',
							vault_family__v: { name__v: 'commercial__v', label__v: 'Commercial' },
							vault_application__v: [{ name: 'pm_promomats__v', label: 'PM: PromoMats' }],
						},
					],
				},
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const info = await client.auth.retrieveDomainInformation('toolbox-authentication');

		expect(info.domainType).toBe('Sandbox');
		expect(info.vaults).toHaveLength(1);
		expect(info.vaults[0]).toMatchObject({
			id: 19523,
			name: 'PromoMats',
			familyLabel: 'Commercial',
			applications: ['PM: PromoMats'],
		});
	});
});

describe('VaultClient.showTargets', () => {
	it('POSTs SHOW TARGETS with the describe header and maps name/label/label_plural, dropping unnamed', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				responseDetails: { pagesize: 1000, size: 2, total: 2 },
				data: [
					{ name: 'product__v', label: 'Product', label_plural: 'Products' },
					{ name: 'country__v', label: 'Country', label_plural: 'Countries' },
					{ label: 'No name' },
				],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const targets = await client.vql.showTargets('toolbox-vql-editor');

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/v26.1/query`);
		expect(req.method).toBe('POST');
		expect(req.headers?.['X-VaultAPI-DescribeQuery']).toBe('true');
		expect((req.body as URLSearchParams).get('q')).toBe('SHOW TARGETS');
		expect(targets).toEqual([
			{ name: 'product__v', label: 'Product', label_plural: 'Products' },
			{ name: 'country__v', label: 'Country', label_plural: 'Countries' },
		]);
	});

	it('builds the SHOW URL from latestApiVersion, not the pinned apiVersion', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', responseDetails: { size: 0, total: 0 }, data: [] }),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v25.1', // pinned version drives user queries
		});
		client.latestApiVersion = 'v26.1'; // discovered latest drives SHOW

		await client.vql.showTargets('toolbox-vql-editor');

		expect(transport.requests[0].url).toBe(`https://${DNS}/api/v26.1/query`);
	});

	it('follows next_page until exhausted and returns all rows', async () => {
		const page1 = resp({
			responseStatus: 'SUCCESS',
			responseDetails: {
				pagesize: 2,
				size: 2,
				total: 3,
				next_page: '/api/v26.1/query/tok?pagesize=2&pageoffset=2',
			},
			data: [{ name: 'a__v' }, { name: 'b__v' }],
		});
		const page2 = resp({
			responseStatus: 'SUCCESS',
			responseDetails: { pagesize: 2, pageoffset: 2, size: 1, total: 3 },
			data: [{ name: 'c__v' }],
		});
		let call = 0;
		const transport = new FakeTransport(() => (call++ === 0 ? page1 : page2));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const targets = await client.vql.showTargets('toolbox-vql-editor');

		expect(targets.map((target) => target.name)).toEqual(['a__v', 'b__v', 'c__v']);
		// The continuation page is POSTed to the next_page URL without the describe header.
		expect(transport.requests[1].url).toBe(
			`https://${DNS}/api/v26.1/query/tok?pagesize=2&pageoffset=2`,
		);
		expect(transport.requests[1].headers?.['X-VaultAPI-DescribeQuery']).toBeUndefined();
	});
});

describe('VaultClient.showFields', () => {
	it('POSTs SHOW FIELDS FROM <target>, reads types from queryDescribe, and maps relationship_name', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				queryDescribe: {
					object: { name: 'product__v' },
					fields: [
						{ name: 'id', type: 'ID' },
						{ name: 'name__v', type: 'String' },
						{ name: 'owner__v', type: 'ObjectReference' },
					],
				},
				responseDetails: { pagesize: 1000, size: 3, total: 3 },
				data: [
					{ name: 'id', label: 'ID' },
					{ name: 'name__v', label: 'Product Name' },
					{ name: 'owner__v', label: 'Owner', relationship_name: 'owner__vr' },
					{ label: 'unnamed' },
				],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const fields = await client.vql.showFields('product__v', 'toolbox-vql-editor');

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/v26.1/query`);
		expect((req.body as URLSearchParams).get('q')).toBe('SHOW FIELDS FROM product__v');
		expect(req.headers?.['X-VaultAPI-DescribeQuery']).toBe('true');
		expect(fields).toEqual([
			{ name: 'id', type: 'ID', label: 'ID', relationship_name: undefined },
			{ name: 'name__v', type: 'String', label: 'Product Name', relationship_name: undefined },
			{
				name: 'owner__v',
				type: 'ObjectReference',
				label: 'Owner',
				relationship_name: 'owner__vr',
			},
		]);
	});

	it('humanizes a field label that echoes the raw API name, leaving real labels untouched', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				queryDescribe: { object: { name: 'product__v' }, fields: [] },
				responseDetails: { pagesize: 1000, size: 2, total: 2 },
				data: [
					{ name: 'cancellation_comment__sys', label: 'cancellation_comment__sys' },
					{ name: 'name__v', label: 'Product Name' },
				],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const fields = await client.vql.showFields('product__v', 'toolbox-vql-editor');

		expect(fields.map((field) => field.label)).toEqual(['Cancellation Comment', 'Product Name']);
	});

	it('throws on a FAILURE envelope', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_DATA', message: 'no such target' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await expect(client.vql.showFields('nope__v', 'toolbox-vql-editor')).rejects.toThrow(/INVALID_DATA/);
	});
});

describe('VaultClient.showRelationships', () => {
	it('POSTs SHOW RELATIONSHIPS FROM <target> and maps name/target/type, dropping unnamed', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				responseDetails: { pagesize: 1000, size: 3, total: 3 },
				data: [
					{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
					{ name: 'approved_countries__cr', target: 'approved_country__c', type: 'inbound' },
					{ target: 'no_name__c', type: 'outbound' },
				],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const relationships = await client.vql.showRelationships('product__v', 'toolbox-vql-editor');

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/v26.1/query`);
		expect(req.method).toBe('POST');
		expect((req.body as URLSearchParams).get('q')).toBe('SHOW RELATIONSHIPS FROM product__v');
		expect(req.headers?.['X-VaultAPI-DescribeQuery']).toBe('true');
		expect(relationships).toEqual([
			{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
			{ name: 'approved_countries__cr', target: 'approved_country__c', type: 'inbound' },
		]);
	});

	it('throws on a FAILURE envelope', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_DATA', message: 'no such target' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await expect(client.vql.showRelationships('nope__v', 'toolbox-vql-editor')).rejects.toThrow(/INVALID_DATA/);
	});
});

describe('VaultClient.retrieveAllPicklists', () => {
	it('GETs /objects/picklists on the latest version and maps name/label/usedIn', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				picklists: [
					{
						name: 'issue_source__v',
						label: 'Source',
						kind: 'global',
						usedIn: [{ objectName: 'issue_escalation__v', propertyName: 'issue_source__v' }],
					},
					{
						name: 'email_template_type__v',
						label: 'Email Template Type',
						usedIn: [
							{ documentTypeName: 'email_template__v', propertyName: 'emailTemplateType_b' },
						],
					},
					// A user picklist with no usedIn — keep the picklist, but with no reverse-map entries.
					{ name: 'license_type__v', label: 'License Type', kind: 'user' },
					{ label: 'no name' },
				],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v25.1',
		});
		client.latestApiVersion = 'v26.1';

		const picklists = await client.metadata.retrieveAllPicklists('toolbox-vql-editor');

		const req = transport.requests[0];
		expect(req.method).toBe('GET');
		expect(req.url).toBe(`https://${DNS}/api/v26.1/objects/picklists`);
		expect(picklists).toEqual([
			{
				name: 'issue_source__v',
				label: 'Source',
				usedIn: [
					{
						objectName: 'issue_escalation__v',
						documentTypeName: undefined,
						propertyName: 'issue_source__v',
					},
				],
			},
			{
				name: 'email_template_type__v',
				label: 'Email Template Type',
				usedIn: [
					{
						objectName: undefined,
						documentTypeName: 'email_template__v',
						propertyName: 'emailTemplateType_b',
					},
				],
			},
			{ name: 'license_type__v', label: 'License Type', usedIn: [] },
		]);
	});

	it('throws on a FAILURE envelope', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'nope' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await expect(client.metadata.retrieveAllPicklists('toolbox-vql-editor')).rejects.toThrow(/INVALID_SESSION_ID/);
	});
});

describe('VaultClient.retrievePicklistValues', () => {
	it('GETs /objects/picklists/{name} on the latest version and maps name/label', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				picklistValues: [
					{ name: 'full__v', label: 'Full User' },
					{ name: 'read_only__v', label: 'Read-only User' },
					{ label: 'no name' },
				],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v25.1',
		});
		client.latestApiVersion = 'v26.1';

		const values = await client.metadata.retrievePicklistValues('license_type__v', 'toolbox-vql-editor');

		const req = transport.requests[0];
		expect(req.method).toBe('GET');
		expect(req.url).toBe(`https://${DNS}/api/v26.1/objects/picklists/license_type__v`);
		expect(values).toEqual([
			{ name: 'full__v', label: 'Full User' },
			{ name: 'read_only__v', label: 'Read-only User' },
		]);
	});

	it('URL-encodes the picklist name', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', picklistValues: [] }),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await client.metadata.retrievePicklistValues('weird name/__v', 'toolbox-vql-editor');

		expect(transport.requests[0].url).toBe(
			`https://${DNS}/api/v26.1/objects/picklists/weird%20name%2F__v`,
		);
	});
});

describe('VaultClient.query', () => {
	const okQuery = {
		responseStatus: 'SUCCESS',
		queryDescribe: { object: { name: 'documents' } },
		responseDetails: {
			pagesize: 2,
			pageoffset: 0,
			size: 2,
			total: 5,
			next_page: '/api/v26.1/query/tok?pagesize=2&pageoffset=2',
		},
		data: [
			{ id: 1, name__v: 'A' },
			{ id: 2, name__v: 'B' },
		],
	};

	it('POSTs the VQL as a q= form param with the describe header, and maps the result', async () => {
		const transport = new FakeTransport(() => resp(okQuery));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const result = await client.vql.query('SELECT id, name__v FROM documents', 'toolbox-vql-editor');

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/v26.1/query`);
		expect(req.method).toBe('POST');
		expect(req.headers?.['X-VaultAPI-DescribeQuery']).toBe('true');
		expect((req.body as URLSearchParams).get('q')).toBe('SELECT id, name__v FROM documents');
		expect(result.data).toHaveLength(2);
		expect(result.responseDetails).toMatchObject({
			total: 5,
			nextPage: okQuery.responseDetails.next_page,
		});
		expect(result.responseDetails.previousPage).toBeUndefined();
		expect(result.queryDescribe).toEqual({ object: { name: 'documents' } });
	});

	it('treats a WARNING responseStatus as success and still returns the data', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'WARNING',
				warnings: [{ type: 'DUPLICATE', message: 'Duplicate query execution detected.' }],
				responseDetails: { pageoffset: 0, size: 1, total: 1 },
				data: [{ id: 1, name__v: 'A' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const result = await client.vql.query('SELECT id, name__v FROM documents', 'toolbox-vql-editor');

		expect(result.data).toEqual([{ id: 1, name__v: 'A' }]);
	});

	it('returns empty data + no pagination for a first/last page with no next_page', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', responseDetails: { size: 0, total: 0 }, data: [] }),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const result = await client.vql.query('SELECT id FROM users', 'toolbox-vql-editor');

		expect(result.data).toEqual([]);
		expect(result.responseDetails.nextPage).toBeUndefined();
		expect(result.responseDetails.previousPage).toBeUndefined();
	});

	it('throws with the Vault error type on a malformed query', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'MALFORMED_QUERY', message: 'bad vql' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await expect(client.vql.query('SELCT', 'toolbox-vql-editor')).rejects.toThrow(/MALFORMED_QUERY/);
	});

	it('attaches the raw FAILURE envelope as the error response', async () => {
		const failureBody = {
			responseStatus: 'FAILURE',
			errors: [{ type: 'MALFORMED_QUERY', message: 'bad vql' }],
		};
		const transport = new FakeTransport(() => resp(failureBody));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const err = await client.vql.query('SELCT', 'toolbox-vql-editor').catch((e: unknown) => e);

		expect(err).toBeInstanceOf(VaultApiError);
		expect((err as VaultApiError).response).toEqual(failureBody);
	});
});

describe('VaultClient.queryAll / queryPages', () => {
	function page(rows: unknown[], nextPage?: string): VaultHttpResponse {
		return resp({
			responseStatus: 'SUCCESS',
			responseDetails: nextPage ? { next_page: nextPage } : {},
			data: rows,
		});
	}

	function pagingClient(handler: (req: HttpRequest) => VaultHttpResponse): {
		client: VaultClient;
		transport: FakeTransport;
	} {
		const transport = new FakeTransport(handler);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS', apiVersion: 'v26.1' });
		return { client, transport };
	}

	it('follows next_page across pages and concatenates every row', async () => {
		const { client, transport } = pagingClient((req) =>
			req.url.includes('/query/p2')
				? page([{ id: 3 }])
				: page([{ id: 1 }, { id: 2 }], '/api/v26.1/query/p2'),
		);

		const rows = await client.vql.queryAll('SELECT id FROM users', 'toolbox-vql-editor');

		expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
		expect(transport.requests[0].url).toBe(`https://${DNS}/api/v26.1/query`);
		expect(transport.requests[1].url).toBe(`https://${DNS}/api/v26.1/query/p2`);
	});

	it('runs the first page against /query/components when target is "components"', async () => {
		const { client, transport } = pagingClient(() => page([{ component_name__v: 'X' }]));

		const rows = await client.vql.queryAll('SELECT component_name__v FROM vault_component__v', 'toolbox-actions-mdl', {
			target: 'components',
		});

		expect(rows).toEqual([{ component_name__v: 'X' }]);
		expect(transport.requests[0].url).toBe(`https://${DNS}/api/v26.1/query/components`);
	});

	it('queryAll stops paging once isCancelled returns true, keeping the rows gathered so far', async () => {
		let served = 0;
		const { client, transport } = pagingClient(() => {
			served += 1;
			// Always advertise a further page so paging would run forever unless cancelled.
			return page([{ id: served }], `/api/v26.1/query/p${served + 1}`);
		});

		let polls = 0;
		const rows = await client.vql.queryAll('SELECT id FROM users', 'toolbox-vql-editor', {
			isCancelled: () => (polls += 1) > 1,
		});

		// First page fetched, one follow allowed (poll #1), then cancelled (poll #2).
		expect(transport.requests).toHaveLength(2);
		expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
	});

	it('queryPages yields one page at a time and honors cancellation between pages', async () => {
		const { client } = pagingClient((req) =>
			req.url.includes('/query/p2') ? page([{ id: 2 }]) : page([{ id: 1 }], '/api/v26.1/query/p2'),
		);

		const seen: unknown[][] = [];
		let cancelAfterFirst = false;
		for await (const rows of client.vql.queryPages('SELECT id FROM users', 'toolbox-vql-editor', {
			isCancelled: () => cancelAfterFirst,
		})) {
			seen.push([...rows]);
			cancelAfterFirst = true;
		}

		expect(seen).toEqual([[{ id: 1 }]]);
	});
});

describe('VaultClient.queryByPage', () => {
	it('POSTs a relative page URL against the Vault origin with no body', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				responseDetails: { pageoffset: 2, size: 2, total: 5 },
				data: [{ id: 3 }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const result = await client.vql.queryByPage('/api/v26.1/query/tok?pagesize=2&pageoffset=2', 'toolbox-vql-editor');

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/v26.1/query/tok?pagesize=2&pageoffset=2`);
		expect(req.method).toBe('POST');
		expect(req.body).toBeUndefined();
		expect(req.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
		expect(result.responseDetails.pageoffset).toBe(2);
	});

	it('surfaces the HTTP status when Vault returns a FAILURE with no error message', async () => {
		const transport = new FakeTransport(() => resp({ responseStatus: 'FAILURE' }, 400));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await expect(client.vql.queryByPage('/api/v26.1/query/tok', 'toolbox-vql-editor')).rejects.toThrow(
			/FAILURE: Request failed \(HTTP 400\)/,
		);
	});
});

describe('VaultClient.queryComponents', () => {
	it('POSTs the VQL as a q= form param to /query/components and maps the result', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				responseDetails: {
					pagesize: 1000,
					pageoffset: 0,
					size: 1,
					total: 1,
					next_page: '/api/v26.1/query/components?pagesize=1000&pageoffset=1000',
				},
				data: [
					{ component_name__v: 'color__c', mdl_definition__v: 'RECREATE Picklist color__c ();' },
				],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const result = await client.vql.queryComponents(
			'SELECT component_name__v, mdl_definition__v FROM vault_component__v',
			'toolbox-actions-vault-compare',
		);

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/v26.1/query/components`);
		expect(req.method).toBe('POST');
		// The component-definition endpoint does not take the describe header (see query() note).
		expect(req.headers?.['X-VaultAPI-DescribeQuery']).toBeUndefined();
		expect((req.body as URLSearchParams).get('q')).toBe(
			'SELECT component_name__v, mdl_definition__v FROM vault_component__v',
		);
		expect(result.data).toHaveLength(1);
		expect(result.responseDetails.nextPage).toBe(
			'/api/v26.1/query/components?pagesize=1000&pageoffset=1000',
		);
	});
});

describe('VaultClient.fetchComponentDefinitions', () => {
	function componentPage(
		data: Array<Record<string, unknown>>,
		nextPage?: string,
	): VaultHttpResponse {
		return resp({
			responseStatus: 'SUCCESS',
			responseDetails: nextPage ? { next_page: nextPage } : {},
			data,
		});
	}

	it('runs the Component Definition Query and accumulates every next_page page', async () => {
		const page2Url = '/api/v26.1/query/components?pagesize=1000&pageoffset=1000';
		const responses = [
			componentPage(
				[{ component_type__v: 'Picklist', component_name__v: 'color__c', mdl_definition__v: 'A' }],
				page2Url,
			),
			componentPage([
				{ component_type__v: 'Object', component_name__v: 'invoice__c', mdl_definition__v: 'B' },
			]),
		];
		let call = 0;
		const transport = new FakeTransport(() => responses[call++]);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const components = await client.mdl.fetchComponentDefinitions('toolbox-actions-vault-compare');

		expect(transport.requests[0].url).toBe(`https://${DNS}/api/v26.1/query/components`);
		expect((transport.requests[0].body as URLSearchParams).get('q')).toBe(
			'SELECT component_name__v, component_type__v, mdl_definition__v FROM vault_component__v',
		);
		expect(transport.requests[1].url).toBe(`https://${DNS}${page2Url}`);
		expect(components).toEqual([
			{ type: 'Picklist', name: 'color__c', mdl: 'A' },
			{ type: 'Object', name: 'invoice__c', mdl: 'B' },
		]);
	});

	it('drops rows whose mdl_definition__v is N/A (code component types)', async () => {
		const transport = new FakeTransport(() =>
			componentPage([
				{ component_type__v: 'Picklist', component_name__v: 'color__c', mdl_definition__v: 'A' },
				{
					component_type__v: 'Recordtrigger',
					component_name__v: 'on_save__c',
					mdl_definition__v: 'N/A',
				},
			]),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const components = await client.mdl.fetchComponentDefinitions('toolbox-actions-vault-compare');

		expect(components).toEqual([{ type: 'Picklist', name: 'color__c', mdl: 'A' }]);
	});
});

describe('VaultClient.retrieveComponentDefinition', () => {
	it('scopes the Component Definition Query by type + name and returns the definition', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				responseDetails: {},
				data: [
					{
						component_type__v: 'Picklist',
						component_name__v: 'color__c',
						mdl_definition__v: 'RECREATE Picklist color__c ();',
					},
				],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const component = await client.mdl.retrieveComponentDefinition('Picklist', 'color__c', 'toolbox-actions-vault-compare');

		expect(transport.requests[0].url).toBe(`https://${DNS}/api/v26.1/query/components`);
		expect((transport.requests[0].body as URLSearchParams).get('q')).toBe(
			'SELECT component_name__v, component_type__v, mdl_definition__v FROM vault_component__v ' +
				"WHERE component_type__v = 'Picklist' AND component_name__v = 'color__c'",
		);
		expect(component).toEqual({
			type: 'Picklist',
			name: 'color__c',
			mdl: 'RECREATE Picklist color__c ();',
		});
	});

	it('returns undefined when the component no longer exists', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', responseDetails: {}, data: [] }),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		expect(await client.mdl.retrieveComponentDefinition('Picklist', 'gone__c', 'toolbox-actions-vault-compare')).toBeUndefined();
	});

	it('rethrows an INVALID_SESSION_ID failure so the connection can recover', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'Session expired' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await expect(client.mdl.retrieveComponentDefinition('Picklist', 'color__c', 'toolbox-actions-vault-compare')).rejects.toMatchObject({
			type: 'INVALID_SESSION_ID',
		});
	});
});

describe('VaultClient.executeMdl', () => {
	const okExecute = {
		responseStatus: 'SUCCESS',
		script_execution: {
			code: 'GEN-S-0',
			message: 'OK',
			warnings: 0,
			failures: 0,
			exceptions: 0,
			components_affected: 1,
			execution_time: 0.028,
		},
		statement_execution: [
			{
				vault: DNS,
				statement: 1,
				command: 'RECREATE',
				component: 'Picklist.color__c',
				message: '[SUCCESS] RECREATE Picklist color__c',
				response: 'SUCCESS',
			},
		],
	};

	const script = "RECREATE Picklist color__c ( label('Color') );";

	it('POSTs the raw MDL script to /mdl/execute with JSON headers and parses the result', async () => {
		const transport = new FakeTransport(() => resp(okExecute));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const result = await client.mdl.executeMdl(script, 'toolbox-actions-mdl');

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/mdl/execute`);
		expect(req.method).toBe('POST');
		expect(req.body).toBe(script);
		expect(req.headers?.['Content-Type']).toBe('application/json');
		expect(req.headers?.['Accept']).toBe('application/json');
		expect(req.headers?.['Authorization']).toBe('SESS');

		expect(result.responseStatus).toBe('SUCCESS');
		expect(result.scriptExecution).toMatchObject({
			failures: 0,
			exceptions: 0,
			componentsAffected: 1,
			executionTime: 0.028,
		});
		expect(result.statements).toHaveLength(1);
		expect(result.statements[0]).toMatchObject({
			statement: 1,
			command: 'RECREATE',
			component: 'Picklist.color__c',
			response: 'SUCCESS',
		});
	});

	it('returns (does not throw) a non-session FAILURE envelope with its script_execution detail intact', async () => {
		const failureBody = {
			responseStatus: 'FAILURE',
			script_execution: {
				code: 'GEN-E-1',
				message: 'Syntax error at line 1',
				warnings: 0,
				failures: 1,
				exceptions: 0,
			},
			statement_execution: [
				{
					statement: 1,
					command: 'RECREATE',
					component: 'Picklist.color__c',
					message: '[FAILURE] Unexpected token',
					response: 'FAILURE',
				},
			],
		};
		const transport = new FakeTransport(() => resp(failureBody));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const result = await client.mdl.executeMdl(script, 'toolbox-actions-mdl');

		expect(result.responseStatus).toBe('FAILURE');
		expect(result.scriptExecution).toMatchObject({
			failures: 1,
			message: 'Syntax error at line 1',
		});
		expect(result.statements[0]).toMatchObject({ response: 'FAILURE' });
	});

	it('carries envelope-level errors on a FAILURE envelope with no statement detail', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'MALFORMED_MDL', message: 'must start with CREATE/RECREATE/...' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		const result = await client.mdl.executeMdl(script, 'toolbox-actions-mdl');

		expect(result.responseStatus).toBe('FAILURE');
		expect(result.statements).toEqual([]);
		expect(result.errors?.[0]).toMatchObject({ type: 'MALFORMED_MDL' });
	});

	it('throws a detectable INVALID_SESSION_ID error (so run() session recovery fires)', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'Invalid or expired' }],
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'STALE',
			apiVersion: 'v26.1',
		});

		const err = await client.mdl.executeMdl(script, 'toolbox-actions-mdl').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(VaultApiError);
		expect(isInvalidSession(err as Error)).toBe(true);
	});

	it("throws 'Unexpected response' when the body is not a Vault envelope", async () => {
		const transport = new FakeTransport(() => resp('<html>gateway error</html>', 502));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await expect(client.mdl.executeMdl(script, 'toolbox-actions-mdl')).rejects.toThrow(/Unexpected response \(HTTP 502\)/);
	});
});

describe('VaultClient.sessionKeepAlive', () => {
	it('resolves on a SUCCESS envelope', async () => {
		const client = new VaultClient({
			vaultDNS: DNS,
			transport: new FakeTransport(() => resp({ responseStatus: 'SUCCESS' })),
			sessionId: 'SESS',
		});
		await expect(client.auth.sessionKeepAlive('toolbox-authentication')).resolves.toBeUndefined();
	});

	it('throws on a FAILURE envelope', async () => {
		const client = new VaultClient({
			vaultDNS: DNS,
			transport: new FakeTransport(() =>
				resp({ responseStatus: 'FAILURE', errors: [{ type: 'X', message: 'no' }] }),
			),
			sessionId: 'SESS',
		});
		await expect(client.auth.sessionKeepAlive('toolbox-authentication')).rejects.toThrow();
	});
});

describe('VaultClient.submitConfigReport', () => {
	it('posts a form-encoded body to the configreport endpoint and returns the job id', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', url: `/api/v26.2/services/jobs/43902`, job_id: 43902 }),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			apiVersion: 'v26.2',
			sessionId: 'SESS',
		});

		const jobId = await client.job.submitConfigReport(
			{
				include_vault_settings: 'true',
				output_format: 'Excel_Macro_Enabled',
			},
			'toolbox-actions-config-report',
		);

		expect(jobId).toBe(43902);
		const request = transport.requests[0];
		expect(request.url).toBe(`https://${DNS}/api/v26.2/objects/vault/actions/configreport`);
		expect(request.method).toBe('POST');
		expect(request.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
		expect((request.body as URLSearchParams).get('include_vault_settings')).toBe('true');
		expect((request.body as URLSearchParams).get('output_format')).toBe('Excel_Macro_Enabled');
	});

	it('throws when the response carries no numeric job id', async () => {
		const transport = new FakeTransport(() => resp({ responseStatus: 'SUCCESS' }));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(client.job.submitConfigReport({}, 'toolbox-actions-config-report')).rejects.toThrow(/no job id/);
	});
});

describe('VaultClient.retrieveJobStatus', () => {
	it('reads the status and download links from data', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'SUCCESS',
				data: {
					id: 43902,
					status: 'SUCCESS',
					links: [
						{ rel: 'self', href: '/api/v26.2/services/jobs/43902', method: 'GET' },
						{ rel: 'artifacts', href: '/api/v26.2/services/jobs/43902/artifacts/report.zip' },
					],
				},
			}),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			apiVersion: 'v26.2',
			sessionId: 'SESS',
		});

		const status = await client.job.retrieveJobStatus(43902, 'toolbox-actions-config-report');

		expect(status.status).toBe('SUCCESS');
		expect(status.links).toEqual([
			{ rel: 'self', href: '/api/v26.2/services/jobs/43902' },
			{ rel: 'artifacts', href: '/api/v26.2/services/jobs/43902/artifacts/report.zip' },
		]);
		expect(transport.requests[0].url).toBe(`https://${DNS}/api/v26.2/services/jobs/43902`);
		expect(transport.requests[0].method).toBe('GET');
	});

	it('tolerates a still-running job with no links yet', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', data: { id: 1, status: 'RUNNING' } }),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		const status = await client.job.retrieveJobStatus(1, 'toolbox-actions-config-report');

		expect(status).toEqual({ status: 'RUNNING', links: [] });
	});
});

describe('VaultClient.downloadJobArtifact', () => {
	it('returns the raw bytes, requesting a binary response against the Vault origin', async () => {
		const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK.." — a ZIP magic prefix
		const transport = new FakeTransport(() => resp(payload));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		const bytes = await client.job.downloadJobArtifact(
			'/api/v26.2/services/jobs/43902/artifacts/report.zip',
			'toolbox-actions-config-report',
		);

		expect(bytes).toEqual(payload);
		expect(transport.requests[0].url).toBe(
			`https://${DNS}/api/v26.2/services/jobs/43902/artifacts/report.zip`,
		);
		expect(transport.requests[0].responseType).toBe('binary');
	});

	it('throws the failure envelope when bytes are not returned (e.g. an expired session)', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'expired' }],
			}),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(client.job.downloadJobArtifact('/report.zip', 'toolbox-actions-config-report')).rejects.toThrow(/INVALID_SESSION_ID/);
	});
});

describe('VaultClient.retrieveSourceCode', () => {
	it('GETs the code endpoint for the class and returns the decoded source text', async () => {
		const source = 'package com.veeva.vault.custom.triggers;\npublic class HelloWorld {}\n';
		const payload = new TextEncoder().encode(source);
		const transport = new FakeTransport(() => resp(payload));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			apiVersion: 'v26.2',
			sessionId: 'SESS',
		});

		const text = await client.sdk.retrieveSourceCode('com.veeva.vault.custom.triggers.HelloWorld', 'toolbox-actions-sdk');

		expect(text).toBe(source);
		expect(transport.requests[0].url).toBe(
			`https://${DNS}/api/v26.2/code/com.veeva.vault.custom.triggers.HelloWorld`,
		);
		expect(transport.requests[0].method).toBe('GET');
		expect(transport.requests[0].responseType).toBe('binary');
	});

	it('throws the failure envelope when file content is not returned (e.g. an expired session)', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'expired' }],
			}),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(
			client.sdk.retrieveSourceCode('com.veeva.vault.custom.triggers.HelloWorld', 'toolbox-actions-sdk'),
		).rejects.toThrow(/INVALID_SESSION_ID/);
	});

	it('throws — not returns — a FAILURE envelope delivered as a binary body on HTTP 200', async () => {
		// The real /code endpoint returns "File not found." as a JSON envelope with a 2xx status, so the
		// transport keeps it as raw bytes; without the parse-and-check this envelope would be written into
		// a .java file verbatim instead of being recorded as a failed download.
		const envelope = JSON.stringify({
			responseStatus: 'FAILURE',
			errors: [{ type: 'INVALID_DATA', message: 'File not found.' }],
		});
		const transport = new FakeTransport(() => resp(new TextEncoder().encode(envelope)));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(
			client.sdk.retrieveSourceCode('com.veeva.vault.custom.triggers.Missing', 'toolbox-actions-sdk'),
		).rejects.toThrow(/File not found\./);
	});
});

describe('VaultClient.addOrReplaceSourceCode', () => {
	const decodeBody = (body: HttpRequest['body']): string =>
		new TextDecoder().decode(body as Uint8Array);

	it('PUTs a multipart/form-data body carrying the file field, and parses the SUCCESS url', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', url: 'com.veeva.vault.custom.triggers.HelloWorld' }),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			apiVersion: 'v26.2',
			sessionId: 'SESS',
		});
		const source = 'package com.veeva.vault.custom.triggers;\npublic class HelloWorld {}\n';

		const result = await client.sdk.addOrReplaceSourceCode(
			'HelloWorld.java',
			new TextEncoder().encode(source),
			'toolbox-actions-sdk',
		);

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/v26.2/code`);
		expect(req.method).toBe('PUT');
		expect(req.headers?.['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
		expect(req.headers?.['Authorization']).toBe('SESS');
		const bodyText = decodeBody(req.body);
		expect(bodyText).toContain('name="file"; filename="HelloWorld.java"');
		expect(bodyText).toContain(source);

		expect(result.responseStatus).toBe('SUCCESS');
		expect(result.url).toBe('com.veeva.vault.custom.triggers.HelloWorld');
	});

	it('returns (does not throw) a non-session FAILURE envelope, even when delivered on HTTP 200', async () => {
		// The /code endpoint can return a FAILURE envelope with a 2xx status; classification is keyed on
		// the envelope, and a non-session failure is a normal outcome the caller renders.
		const transport = new FakeTransport(() =>
			resp(
				{
					responseStatus: 'FAILURE',
					errors: [{ type: 'INVALID_DATA', message: 'Package must be com.veeva.vault.custom.' }],
				},
				200,
			),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			apiVersion: 'v26.2',
			sessionId: 'SESS',
		});

		const result = await client.sdk.addOrReplaceSourceCode('Bad.java', new TextEncoder().encode('x'), 'toolbox-actions-sdk');

		expect(result.responseStatus).toBe('FAILURE');
		expect(result.errors?.[0]?.message).toBe('Package must be com.veeva.vault.custom.');
	});

	it('throws INVALID_SESSION_ID on an expired-session FAILURE envelope', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'expired' }],
			}),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'STALE' });

		const err = await client.sdk
			.addOrReplaceSourceCode('HelloWorld.java', new TextEncoder().encode('x'), 'toolbox-actions-sdk')
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(VaultApiError);
		expect(isInvalidSession(err as Error)).toBe(true);
	});

	it("throws 'Unexpected response' when the body is not a Vault envelope", async () => {
		const transport = new FakeTransport(() => resp('<html>gateway error</html>', 502));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(
			client.sdk.addOrReplaceSourceCode('HelloWorld.java', new TextEncoder().encode('x'), 'toolbox-actions-sdk'),
		).rejects.toThrow(/Unexpected response \(HTTP 502\)/);
	});
});

describe('VaultClient.deleteSourceCode', () => {
	const className = 'com.veeva.vault.custom.triggers.HelloWorld';

	it('DELETEs the class-scoped code endpoint with no body and parses the SUCCESS envelope', async () => {
		const transport = new FakeTransport(() => resp({ responseStatus: 'SUCCESS' }));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			apiVersion: 'v26.2',
			sessionId: 'SESS',
		});

		const result = await client.sdk.deleteSourceCode(className, 'toolbox-actions-sdk');

		const req = transport.requests[0];
		expect(req.url).toBe(`https://${DNS}/api/v26.2/code/${className}`);
		expect(req.method).toBe('DELETE');
		expect(req.body).toBeUndefined();
		expect(req.headers?.['Authorization']).toBe('SESS');
		expect(result.responseStatus).toBe('SUCCESS');
	});

	it('returns (does not throw) a non-session FAILURE envelope, even on HTTP 200', async () => {
		// Vault's "code component currently in use" rejection is a normal outcome the caller renders, and
		// /code can deliver a FAILURE envelope with a 2xx status.
		const transport = new FakeTransport(() =>
			resp(
				{
					responseStatus: 'FAILURE',
					errors: [{ type: 'OPERATION_NOT_ALLOWED', message: 'Code component currently in use.' }],
				},
				200,
			),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		const result = await client.sdk.deleteSourceCode(className, 'toolbox-actions-sdk');

		expect(result.responseStatus).toBe('FAILURE');
		expect(result.errors?.[0]?.message).toBe('Code component currently in use.');
	});

	it('throws INVALID_SESSION_ID on an expired-session FAILURE envelope', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'expired' }],
			}),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'STALE' });

		const err = await client.sdk.deleteSourceCode(className, 'toolbox-actions-sdk').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(VaultApiError);
		expect(isInvalidSession(err as Error)).toBe(true);
	});
});

describe('VaultClient.downloadApiUsageLog', () => {
	it('GETs the api_usage endpoint with the query params, requesting a binary response', async () => {
		const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK.." — a ZIP magic prefix
		const transport = new FakeTransport(() => resp(payload));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			apiVersion: 'v26.2',
			sessionId: 'SESS',
		});

		const bytes = await client.logs.downloadApiUsageLog({ date: '2026-08-27', log_format: 'csv' }, 'toolbox-actions-developer-logs');

		expect(bytes).toEqual(payload);
		expect(transport.requests[0].url).toBe(
			`https://${DNS}/api/v26.2/logs/api_usage?date=2026-08-27&log_format=csv`,
		);
		expect(transport.requests[0].method).toBe('GET');
		expect(transport.requests[0].responseType).toBe('binary');
	});

	it('throws the failure envelope when bytes are not returned (e.g. an expired session)', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'expired' }],
			}),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(
			client.logs.downloadApiUsageLog({ date: '2026-08-27', log_format: 'csv' }, 'toolbox-actions-developer-logs'),
		).rejects.toThrow(/INVALID_SESSION_ID/);
	});
});

describe('VaultClient.downloadSdkRuntimeLog', () => {
	it('GETs the code/runtime endpoint with the query params, requesting a binary response', async () => {
		const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK.." — a ZIP magic prefix
		const transport = new FakeTransport(() => resp(payload));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			apiVersion: 'v26.2',
			sessionId: 'SESS',
		});

		const bytes = await client.logs.downloadSdkRuntimeLog({ date: '2026-08-27', log_format: 'csv' }, 'toolbox-actions-developer-logs');

		expect(bytes).toEqual(payload);
		expect(transport.requests[0].url).toBe(
			`https://${DNS}/api/v26.2/logs/code/runtime?date=2026-08-27&log_format=csv`,
		);
		expect(transport.requests[0].method).toBe('GET');
		expect(transport.requests[0].responseType).toBe('binary');
	});

	it('throws the failure envelope when bytes are not returned (e.g. an expired session)', async () => {
		const transport = new FakeTransport(() =>
			resp({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'expired' }],
			}),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await expect(
			client.logs.downloadSdkRuntimeLog({ date: '2026-08-27', log_format: 'csv' }, 'toolbox-actions-developer-logs'),
		).rejects.toThrow(/INVALID_SESSION_ID/);
	});
});

describe('VaultClient reference ID tagging (X-VaultAPI-ReferenceID)', () => {
	it('sends the header with the supplied ToolboxFeatureArea value, per namespace', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', responseDetails: {}, data: [] }),
		);
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await client.vql.query('SELECT id FROM documents', 'toolbox-vql-editor');

		expect(transport.requests[0].headers?.[HEADER_REFERENCE_ID]).toBe('toolbox-vql-editor');
	});

	it('tags a form-encoded call (formHeaders) the same way as a plain header() call', async () => {
		const transport = new FakeTransport(() => resp({ responseStatus: 'SUCCESS', job_id: 1 }));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await client.job.submitConfigReport({}, 'toolbox-actions-config-report');

		expect(transport.requests[0].headers?.[HEADER_REFERENCE_ID]).toBe(
			'toolbox-actions-config-report',
		);
	});

	it('tags every request of a multi-page pull with the same reference ID (queryByPage fan-out)', async () => {
		const page1 = resp({
			responseStatus: 'SUCCESS',
			responseDetails: { next_page: '/api/v26.1/query/tok?pagesize=2&pageoffset=2' },
			data: [{ name: 'a__v' }],
		});
		const page2 = resp({ responseStatus: 'SUCCESS', responseDetails: {}, data: [{ name: 'b__v' }] });
		let call = 0;
		const transport = new FakeTransport(() => (call++ === 0 ? page1 : page2));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await client.vql.showTargets('toolbox-vql-editor');

		expect(transport.requests).toHaveLength(2);
		for (const req of transport.requests) {
			expect(req.headers?.[HEADER_REFERENCE_ID]).toBe('toolbox-vql-editor');
		}
	});

	it('tags a representative connect call (auth.authenticateBasic) with toolbox-authentication', async () => {
		const transport = new FakeTransport(() =>
			resp({ responseStatus: 'SUCCESS', sessionId: 'NEW_SESSION', vaultId: 1776, vaultIds: [] }),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport });

		await client.auth.authenticateBasic('admin', 'pw', 'toolbox-authentication');

		expect(transport.requests[0].headers?.[HEADER_REFERENCE_ID]).toBe('toolbox-authentication');
	});

	it('tags a representative MDL call (mdl.executeMdl) with toolbox-actions-mdl (deploy/drop/extract)', async () => {
		const transport = new FakeTransport(() => resp({ responseStatus: 'SUCCESS' }));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await client.mdl.executeMdl('RECREATE Picklist color__c ();', 'toolbox-actions-mdl');

		expect(transport.requests[0].headers?.[HEADER_REFERENCE_ID]).toBe('toolbox-actions-mdl');
	});

	it('tags a representative SDK call (sdk.retrieveSourceCode) with toolbox-actions-sdk (deploy/delete/extract)', async () => {
		const transport = new FakeTransport(() =>
			resp(new TextEncoder().encode('package com.veeva.vault.custom; public class X {}')),
		);
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await client.sdk.retrieveSourceCode('com.veeva.vault.custom.X', 'toolbox-actions-sdk');

		expect(transport.requests[0].headers?.[HEADER_REFERENCE_ID]).toBe('toolbox-actions-sdk');
	});

	it('tags a representative Config Report call (job.submitConfigReport) with toolbox-actions-config-report', async () => {
		const transport = new FakeTransport(() => resp({ responseStatus: 'SUCCESS', job_id: 1 }));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await client.job.submitConfigReport({}, 'toolbox-actions-config-report');

		expect(transport.requests[0].headers?.[HEADER_REFERENCE_ID]).toBe(
			'toolbox-actions-config-report',
		);
	});

	it('tags both Developer Log downloads with the shared toolbox-actions-developer-logs value', async () => {
		const payload = new Uint8Array([1, 2, 3]);
		const transport = new FakeTransport(() => resp(payload));
		const client = new VaultClient({ vaultDNS: DNS, transport, sessionId: 'SESS' });

		await client.logs.downloadApiUsageLog({ date: '2026-08-27' }, 'toolbox-actions-developer-logs');
		await client.logs.downloadSdkRuntimeLog({ date: '2026-08-27' }, 'toolbox-actions-developer-logs');

		for (const req of transport.requests) {
			expect(req.headers?.[HEADER_REFERENCE_ID]).toBe('toolbox-actions-developer-logs');
		}
	});

	it('tags every request of a cross-namespace fan-out identically (mdl.fetchComponentDefinitions -> vql.queryComponents)', async () => {
		const page1 = resp({
			responseStatus: 'SUCCESS',
			responseDetails: { next_page: '/api/v26.1/query/components?pageoffset=1000' },
			data: [{ component_type__v: 'Picklist', component_name__v: 'color__c', mdl_definition__v: 'A' }],
		});
		const page2 = resp({
			responseStatus: 'SUCCESS',
			responseDetails: {},
			data: [{ component_type__v: 'Object', component_name__v: 'invoice__c', mdl_definition__v: 'B' }],
		});
		let call = 0;
		const transport = new FakeTransport(() => (call++ === 0 ? page1 : page2));
		const client = new VaultClient({
			vaultDNS: DNS,
			transport,
			sessionId: 'SESS',
			apiVersion: 'v26.1',
		});

		await client.mdl.fetchComponentDefinitions('toolbox-actions-vault-compare');

		expect(transport.requests).toHaveLength(2);
		for (const req of transport.requests) {
			expect(req.headers?.[HEADER_REFERENCE_ID]).toBe('toolbox-actions-vault-compare');
		}
	});
});
