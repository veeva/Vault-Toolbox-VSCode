import type { ComponentDefinition } from '../compare/compareComponents';
import type { JobStatus } from '../job/jobStatus';
import { displayLabel } from '../vql/apiLabel';
import {
	firstErrorMessage,
	isFailure,
	isInvalidSession,
	isVaultResponse,
	VaultApiError,
} from './errors';
import type {
	AuthResult,
	DomainInfo,
	DomainVault,
	HttpRequest,
	HttpTransport,
	MdlExecuteResult,
	MdlScriptExecution,
	MdlStatementResult,
	QueryDescribe,
	QueryPageOptions,
	QueryResponseDetails,
	QueryResult,
	QueryRow,
	VaultFieldMeta,
	VaultHttpResponse,
	VaultObjectMetadataSummary,
	VaultObjectSummary,
	VaultPicklistSummary,
	VaultPicklistValue,
	VaultRelationshipMeta,
	SdkCodeResult,
	ToolboxFeatureArea,
	VaultResponse,
	VaultUser,
} from './types';
import { encodeMultipartFormData } from './multipart';

/** Bootstrap version used ONLY for the initial /auth handshake; the real version is discovered. */
export const DEFAULT_BOOTSTRAP_API_VERSION = 'v26.1';
export const DEFAULT_CLIENT_ID = 'veeva-vault-toolbox-vscode';
/**
 * Fail-fast deadline for connection-liveness calls: the connect handshake (auth, version discovery,
 * session validation, domain lookup) plus session keep-alive. These probe whether a reachable Vault
 * and a live session still exist, so an unreachable host (wrong DNS, firewall black-hole) must abort
 * rather than hang forever. User data operations (queries, MDL, picklists, metadata SHOW) omit any
 * timeout and wait for Vault to respond — hence this is hardcoded, not a setting.
 */
export const CONNECT_TIMEOUT_MS = 15000;

const HEADER_CLIENT_ID = 'X-VaultAPI-ClientID';
const HEADER_REFERENCE_ID = 'X-VaultAPI-ReferenceID';
const HEADER_AUTHORIZATION = 'Authorization';
const HEADER_VAULT_ID = 'X-VaultAPI-VaultId';
const HEADER_DESCRIBE_QUERY = 'X-VaultAPI-DescribeQuery';
const HEADER_ACCEPT = 'Accept';
const HEADER_CONTENT_TYPE = 'Content-Type';
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const JSON_CONTENT_TYPE = 'application/json';

/** Cap on raw error-body text carried into a diagnostic message, to avoid ballooning on HTML pages. */
const MAX_ERROR_BODY_CHARS = 300;

/** The Component Definition Query's SELECT list (see CONTEXT.md) — name, type, and the MDL body. */
const COMPONENT_DEFINITION_SELECT =
	'SELECT component_name__v, component_type__v, mdl_definition__v FROM vault_component__v';

/** `mdl_definition__v` sentinel for code component types (no MDL body); such rows are excluded. */
const NO_MDL_DEFINITION = 'N/A';

export interface VaultClientOptions {
	vaultDNS: string;
	transport: HttpTransport;
	/** Pinned API version. If omitted, a bootstrap version is used until auth.discoverLatestApiVersion() runs. */
	apiVersion?: string;
	sessionId?: string;
	clientId?: string;
}

/**
 * Minimal Vault REST client for the PoC (see plan). Framework-agnostic and transport-injected.
 * Endpoints verified against the v26.1 REST docs.
 *
 * Methods are grouped into domain namespaces on `readonly` fields so callers navigate by feature
 * rather than scrolling a flat list:
 *
 *   client.auth      — authentication, session management, domain info
 *   client.vql       — VQL queries, pagination, SHOW metadata
 *   client.metadata  — picklist retrieval (REST, not SHOW)
 *   client.mdl       — MDL Execute, Component Definition Query (Compare Environments)
 *   client.job       — async job submission, polling, and artifact download
 *   client.sdk       — Vault Java SDK source code CRUD
 *   client.logs      — Developer Log downloads (API Usage, SDK Runtime)
 *
 * Top-level properties (`vaultDNS`, `apiVersion`, `latestApiVersion`, `sessionId`, `vaultId`) are
 * read/written directly on the instance — they reflect shared session state, not a single domain.
 */
export class VaultClient {
	readonly vaultDNS: string;
	private readonly transport: HttpTransport;
	private readonly clientId: string;

	/** Version for user-issued traffic (auth, user queries). Pinned when supplied, else discovered. */
	apiVersion: string;
	/**
	 * The Vault's latest supported API version, discovered at connect. Background metadata (`SHOW`)
	 * calls always target this, so they never run against an older pinned {@link apiVersion}.
	 */
	latestApiVersion: string;
	sessionId?: string;
	vaultId?: number;

	/** True when the caller pinned an explicit version; keeps discovery from overriding user traffic. */
	private readonly apiVersionPinned: boolean;

	constructor(opts: VaultClientOptions) {
		this.vaultDNS = opts.vaultDNS;
		this.transport = opts.transport;
		this.apiVersionPinned = Boolean(opts.apiVersion);
		this.apiVersion = opts.apiVersion || DEFAULT_BOOTSTRAP_API_VERSION;
		this.latestApiVersion = this.apiVersion;
		this.sessionId = opts.sessionId;
		this.clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
	}

	// ── Private infrastructure ────────────────────────────────────────────────

	private apiBase(version: string = this.apiVersion): string {
		return `https://${this.vaultDNS}/api/${version}`;
	}

	private headers(
		referenceId: ToolboxFeatureArea,
		extra?: Record<string, string>,
	): Record<string, string> {
		const merged: Record<string, string> = {
			[HEADER_CLIENT_ID]: this.clientId,
			[HEADER_REFERENCE_ID]: referenceId,
			...extra,
		};
		if (this.sessionId) {
			merged[HEADER_AUTHORIZATION] = this.sessionId;
		}
		return merged;
	}

	/** Headers for the form-encoded `/query` endpoints; `extra` merges in (e.g. DescribeQuery). */
	private formHeaders(
		referenceId: ToolboxFeatureArea,
		extra?: Record<string, string>,
	): Record<string, string> {
		return this.headers(referenceId, {
			[HEADER_CONTENT_TYPE]: FORM_CONTENT_TYPE,
			[HEADER_ACCEPT]: 'application/json',
			...extra,
		});
	}

	/**
	 * `timeoutMs` is passed only by connection-liveness calls (see {@link CONNECT_TIMEOUT_MS});
	 * user data calls omit it so the request waits for Vault rather than aborting client-side.
	 */
	private async send(req: HttpRequest, timeoutMs?: number): Promise<VaultHttpResponse> {
		return this.transport.send(req, timeoutMs);
	}

	/** Parse a response body as a VaultResponse, throwing on a FAILURE envelope. */
	private expectSuccess(res: VaultHttpResponse): VaultResponse & Record<string, unknown> {
		const body = res.body;
		if (!isVaultResponse(body)) {
			throw new VaultApiError(`Unexpected response (HTTP ${res.status})`);
		}
		if (isFailure(body)) {
			throw failureApiError(body, res.status, 'FAILURE');
		}
		return body as VaultResponse & Record<string, unknown>;
	}

	/**
	 * Guard against Vault "auth-defaulting": if the authenticated Vault's URL host does not match the
	 * requested DNS, we connected to the wrong Vault — treat it as a failure.
	 */
	private verifyAuthenticatedDns(
		vaultId: number | undefined,
		vaultIds: AuthResult['vaultIds'],
	): void {
		if (vaultId === undefined || vaultIds.length === 0) {
			return; // nothing to verify against
		}
		const matched = vaultIds.find((vault) => vault.id === vaultId);
		if (!matched) {
			// The authenticated Vault id is absent from the returned (non-empty) Vault list, so we can't
			// confirm we reached the requested DNS. Fail closed rather than trust an auth-defaulted session.
			throw new VaultApiError(
				`Authenticated Vault ${vaultId} is not in the returned Vault list; cannot confirm the ` +
					`connection targets ${this.vaultDNS}.`,
				'VAULT_DNS_MISMATCH',
			);
		}
		let host: string;
		try {
			host = new URL(matched.url).host.toLowerCase();
		} catch {
			return;
		}
		if (host !== this.vaultDNS.toLowerCase()) {
			throw new VaultApiError(
				`Authenticated to ${host}, not the requested ${this.vaultDNS} (Vault auth-defaulting). ` +
					`Check the DNS or your Vault membership.`,
				'VAULT_DNS_MISMATCH',
			);
		}
	}

	/**
	 * Execute a `SHOW …` metadata query against the latest-version `/query` endpoint, keeping the
	 * `X-VaultAPI-DescribeQuery` header so the first page carries `queryDescribe` (field types), then
	 * follow `next_page` to completion. Pagination is followed defensively — SHOW's behaviour beyond
	 * one page (Vault's default page size is 1000) is unverified against a live Vault — using the standard
	 * `next_page` chain, which the continuation endpoint does not re-describe.
	 */
	private async runShowQuery(
		vql: string,
		referenceId: ToolboxFeatureArea,
	): Promise<{ rows: QueryRow[]; describe: QueryDescribe | undefined }> {
		const res = await this.send({
			url: `${this.apiBase(this.latestApiVersion)}/query`,
			method: 'POST',
			headers: this.formHeaders(referenceId, { [HEADER_DESCRIBE_QUERY]: 'true' }),
			body: vqlQueryBody(vql),
		});
		const first = this.parseQueryResult(res);
		return {
			rows: await this.accumulateQueryRows(first, referenceId),
			describe: first.queryDescribe,
		};
	}

	/**
	 * Follow a query's `next_page` chain, yielding each page in turn: seed with `first`, then POST each
	 * continuation URL via {@link vql.queryByPage} until exhausted. `isCancelled` is polled before each
	 * continuation so a long pull can be stopped between pages. The single follow-loop shared by every
	 * paginated pull — {@link accumulateQueryRows} (SHOW metadata) and the public {@link vql.queryPages}.
	 */
	private async *followPages(
		first: QueryResult,
		referenceId: ToolboxFeatureArea,
		isCancelled?: () => boolean,
	): AsyncGenerator<QueryResult> {
		yield first;
		let nextPage = first.responseDetails.nextPage;
		while (nextPage && !isCancelled?.()) {
			const page = await this.vql.queryByPage(nextPage, referenceId);
			yield page;
			nextPage = page.responseDetails.nextPage;
		}
	}

	/**
	 * Accumulate every row of a query across pages: seed from `first`, then follow its `next_page` chain
	 * until exhausted. `isCancelled` is polled between pages so a long pull can be aborted; the partial
	 * result the caller then discards is never used.
	 */
	private async accumulateQueryRows(
		first: QueryResult,
		referenceId: ToolboxFeatureArea,
		isCancelled?: () => boolean,
	): Promise<QueryRow[]> {
		const rows: QueryRow[] = [];
		for await (const page of this.followPages(first, referenceId, isCancelled)) {
			rows.push(...page.data);
		}
		return rows;
	}

	/**
	 * Fetch a query's first page from the chosen endpoint, then follow its pages, yielding each page's
	 * rows. Backs the public {@link vql.queryPages}; kept a class method (not an arrow in the `vql`
	 * literal) so it can be a generator with `this` bound to the client.
	 */
	private async *paginateRows(
		vql: string,
		referenceId: ToolboxFeatureArea,
		options?: QueryPageOptions,
	): AsyncGenerator<readonly QueryRow[]> {
		const first =
			options?.target === 'components'
				? await this.vql.queryComponents(vql, referenceId)
				: await this.vql.query(vql, referenceId);
		for await (const page of this.followPages(first, referenceId, options?.isCancelled)) {
			yield page.data;
		}
	}

	/** Resolve a (usually relative) pagination URL against this Vault's origin. */
	private resolvePageUrl(pageUrl: string): string {
		if (/^https?:\/\//i.test(pageUrl)) {
			return pageUrl;
		}
		const path = pageUrl.startsWith('/') ? pageUrl : `/${pageUrl}`;
		return `https://${this.vaultDNS}${path}`;
	}

	private parseQueryResult(res: VaultHttpResponse): QueryResult {
		const body = this.expectSuccess(res);
		const data = Array.isArray(body['data']) ? (body['data'] as QueryRow[]) : [];
		const rawResponseDetails = (body['responseDetails'] ?? {}) as Record<string, unknown>;
		const responseDetails: QueryResponseDetails = {
			pagesize: numberOrUndefined(rawResponseDetails['pagesize']),
			pageoffset: numberOrUndefined(rawResponseDetails['pageoffset']),
			size: numberOrUndefined(rawResponseDetails['size']),
			total: numberOrUndefined(rawResponseDetails['total']),
			nextPage: stringOrUndefined(rawResponseDetails['next_page']),
			previousPage: stringOrUndefined(rawResponseDetails['previous_page']),
		};
		return {
			data,
			responseDetails,
			queryDescribe: body['queryDescribe'] as QueryDescribe | undefined,
			raw: body,
		};
	}

	/**
	 * Parse a `/code` write/delete response into an {@link SdkCodeResult}. Shared by
	 * {@link sdk.addOrReplaceSourceCode} and {@link sdk.deleteSourceCode}. Keyed on the envelope (not
	 * the HTTP status) because `/code` can return FAILURE-on-2xx; re-throws only an expired-session
	 * FAILURE so the connection's re-auth retry fires, and returns every other envelope for the caller
	 * to render.
	 */
	private parseSdkCodeResult(res: VaultHttpResponse): SdkCodeResult {
		const body = res.body;
		if (!isVaultResponse(body)) {
			throw new VaultApiError(`Unexpected response (HTTP ${res.status})`);
		}
		if (isFailure(body) && isInvalidSession(body)) {
			throw failureApiError(body, res.status, 'INVALID_SESSION_ID');
		}
		const record = body as VaultResponse & Record<string, unknown>;
		return {
			responseStatus: record.responseStatus,
			responseMessage: stringOrUndefined(record['responseMessage']),
			url: stringOrUndefined(record['url']),
			errors: record.errors,
		};
	}

	// ── Auth & Session ────────────────────────────────────────────────────────

	readonly auth = {
		/**
		 * Set the session for Session-ID auth (no /auth call needed). Takes no `referenceId` — unlike
		 * every other method here, this makes no HTTP call, so there's nothing to tag.
		 */
		setSession: (sessionId: string): void => {
			this.sessionId = sessionId;
		},

		/**
		 * GET /api/ — discover the Vault's supported versions and record the latest as
		 * {@link latestApiVersion} (which `SHOW` metadata calls always target). When the version was NOT
		 * pinned, the latest also becomes {@link apiVersion} so user traffic uses it too; a pinned version
		 * is left untouched.
		 */
		discoverLatestApiVersion: async (referenceId: ToolboxFeatureArea): Promise<string> => {
			const res = await this.send(
				{
					url: `https://${this.vaultDNS}/api/`,
					method: 'GET',
					headers: this.headers(referenceId),
				},
				CONNECT_TIMEOUT_MS,
			);
			const body = this.expectSuccess(res);
			const values = body['values'];
			if (typeof values !== 'object' || values === null) {
				throw new VaultApiError('No API versions returned by Vault');
			}
			const latest = pickLatestApiVersion(values as Record<string, string>);
			this.latestApiVersion = latest;
			if (!this.apiVersionPinned) {
				this.apiVersion = latest;
			}
			return latest;
		},

		/** POST /api/{v}/auth — Basic authentication. Verifies the returned Vault matches the DNS. */
		authenticateBasic: async (
			username: string,
			password: string,
			referenceId: ToolboxFeatureArea,
		): Promise<AuthResult> => {
			const body = new URLSearchParams();
			body.append('username', username);
			body.append('password', password);
			body.append('vaultDNS', this.vaultDNS);

			const res = await this.send(
				{
					url: `${this.apiBase()}/auth`,
					method: 'POST',
					headers: this.headers(referenceId, {
						'Content-Type': 'application/x-www-form-urlencoded',
					}),
					body,
				},
				CONNECT_TIMEOUT_MS,
			);
			const parsed = this.expectSuccess(res);

			const sessionId = parsed['sessionId'];
			if (typeof sessionId !== 'string') {
				throw new VaultApiError('Authentication succeeded but no sessionId was returned');
			}
			const vaultId =
				typeof parsed['vaultId'] === 'number' ? (parsed['vaultId'] as number) : undefined;
			const vaultIds = Array.isArray(parsed['vaultIds'])
				? (parsed['vaultIds'] as AuthResult['vaultIds'])
				: [];

			this.verifyAuthenticatedDns(vaultId, vaultIds);

			this.sessionId = sessionId;
			this.vaultId = vaultId;
			return {
				sessionId,
				userId: typeof parsed['userId'] === 'number' ? (parsed['userId'] as number) : undefined,
				vaultId,
				vaultIds,
			};
		},

		/** GET /api/{v}/objects/users/me — validate the session and return the current user. */
		validateSessionUser: async (referenceId: ToolboxFeatureArea): Promise<VaultUser> => {
			const res = await this.send(
				{
					url: `${this.apiBase()}/objects/users/me`,
					method: 'GET',
					headers: this.headers(referenceId),
				},
				CONNECT_TIMEOUT_MS,
			);
			const body = this.expectSuccess(res);

			const users = body['users'];
			const user =
				Array.isArray(users) && users.length > 0
					? ((users[0] as { user?: Record<string, unknown> }).user ?? {})
					: {};

			const headerVaultId = res.getHeader(HEADER_VAULT_ID);
			if (headerVaultId && !Number.isNaN(Number(headerVaultId))) {
				this.vaultId = Number(headerVaultId);
			}

			return {
				id: numberOrUndefined(user['id']),
				userName: stringOrUndefined(user['user_name__v']),
				firstName: stringOrUndefined(user['user_first_name__v']),
				lastName: stringOrUndefined(user['user_last_name__v']),
				email: stringOrUndefined(user['user_email__v']),
				vaultId: this.vaultId,
			};
		},

		/** GET /api/{v}/objects/domain — domain + per-Vault info (requires Domain Admin). */
		retrieveDomainInformation: async (referenceId: ToolboxFeatureArea): Promise<DomainInfo> => {
			const res = await this.send(
				{
					url: `${this.apiBase()}/objects/domain?include_application=true`,
					method: 'GET',
					headers: this.headers(referenceId),
				},
				CONNECT_TIMEOUT_MS,
			);
			const body = this.expectSuccess(res);
			const domain = (body['domain__v'] ?? {}) as Record<string, unknown>;
			const rawVaults = Array.isArray(domain['vaults__v'])
				? (domain['vaults__v'] as unknown[])
				: [];

			return {
				domainName: stringOrUndefined(domain['domain_name__v']),
				domainType: stringOrUndefined(domain['domain_type__v']),
				vaults: rawVaults.map(mapDomainVault),
			};
		},

		/** POST /api/{v}/keep-alive — refresh the session. */
		sessionKeepAlive: async (referenceId: ToolboxFeatureArea): Promise<void> => {
			const res = await this.send(
				{
					url: `${this.apiBase()}/keep-alive`,
					method: 'POST',
					headers: this.headers(referenceId),
				},
				CONNECT_TIMEOUT_MS,
			);
			this.expectSuccess(res);
		},
	};

	// ── VQL ───────────────────────────────────────────────────────────────────

	readonly vql = {
		/**
		 * POST /api/{v}/query — execute a VQL query. Sends `X-VaultAPI-DescribeQuery: true` so the
		 * response carries `queryDescribe` (subquery field lists, used to render/export subquery columns).
		 */
		query: async (vql: string, referenceId: ToolboxFeatureArea): Promise<QueryResult> => {
			const res = await this.send({
				url: `${this.apiBase()}/query`,
				method: 'POST',
				headers: this.formHeaders(referenceId, { [HEADER_DESCRIBE_QUERY]: 'true' }),
				body: vqlQueryBody(vql),
			});
			return this.parseQueryResult(res);
		},

		/**
		 * POST a `next_page`/`previous_page` pagination URL. Per the Vault docs these must be called with
		 * POST (not GET), with no body — the offset is encoded in the URL, and the URL already replays the
		 * original query context. We send the form Content-Type to match the `/query` contract but do NOT
		 * re-send `X-VaultAPI-DescribeQuery`: describe applies to the initial query only, `queryDescribe`
		 * is unconsumed here, and re-sending it on the continuation endpoint makes Vault return a bare
		 * `FAILURE` (HTTP 200).
		 */
		queryByPage: async (
			pageUrl: string,
			referenceId: ToolboxFeatureArea,
		): Promise<QueryResult> => {
			const res = await this.send({
				url: this.resolvePageUrl(pageUrl),
				method: 'POST',
				headers: this.formHeaders(referenceId),
			});
			return this.parseQueryResult(res);
		},

		/**
		 * POST /api/{v}/query/components — the Configuration Migration "Component Definition Query": run a
		 * VQL query against the `vault_component__v` / `vault_package_component__v` targets to retrieve each
		 * component's `mdl_definition__v`. Same response shape as `/query`; paginate with {@link queryByPage}.
		 * No `X-VaultAPI-DescribeQuery` header — describe applies only to the standard `/query` endpoint.
		 */
		queryComponents: async (
			vql: string,
			referenceId: ToolboxFeatureArea,
		): Promise<QueryResult> => {
			const res = await this.send({
				url: `${this.apiBase()}/query/components`,
				method: 'POST',
				headers: this.formHeaders(referenceId),
				body: vqlQueryBody(vql),
			});
			return this.parseQueryResult(res);
		},

		/**
		 * Run a query and yield its rows one page at a time, following `next_page` to completion so the
		 * caller never touches the pagination protocol. Use this for a streaming pull — writing or
		 * reporting progress per page — over the standard `/query` (default) or the `/query/components`
		 * Component Definition Query (`options.target: 'components'`). Cancellable via `options.isCancelled`.
		 */
		queryPages: (
			vql: string,
			referenceId: ToolboxFeatureArea,
			options?: QueryPageOptions,
		): AsyncGenerator<readonly QueryRow[]> => this.paginateRows(vql, referenceId, options),

		/**
		 * Run a query and return every row across all pages as one array — the collect-all convenience over
		 * {@link queryPages} for callers that just want the full result set. Same endpoint choice and
		 * cancellation as `queryPages`; on cancellation the rows gathered so far are returned.
		 */
		queryAll: async (
			vql: string,
			referenceId: ToolboxFeatureArea,
			options?: QueryPageOptions,
		): Promise<QueryRow[]> => {
			const rows: QueryRow[] = [];
			for await (const page of this.vql.queryPages(vql, referenceId, options)) {
				rows.push(...page);
			}
			return rows;
		},

		/**
		 * `SHOW TARGETS` — list every VQL query target (objects, documents, users, …) as name + label
		 * (+ `label_plural`) for VQL FROM completion. Runs through the latest-version `/query` endpoint.
		 */
		showTargets: async (referenceId: ToolboxFeatureArea): Promise<VaultObjectSummary[]> => {
			const { rows } = await this.runShowQuery('SHOW TARGETS', referenceId);
			return rows
				.map((row) => {
					const name = stringOrUndefined(row['name']) ?? '';
					return {
						name,
						label: displayLabel(name, stringOrUndefined(row['label'])),
						label_plural: displayLabel(name, stringOrUndefined(row['label_plural'])),
					};
				})
				.filter((target) => target.name.length > 0);
		},

		/**
		 * `SHOW FIELDS FROM <target>` — a target's field metadata for VQL SELECT/WHERE completion. Field
		 * types are read from the `queryDescribe` block (the reason the describe header is kept), keyed by
		 * field name; `relationship_name` is present only for reference fields.
		 */
		showFields: async (
			target: string,
			referenceId: ToolboxFeatureArea,
		): Promise<VaultFieldMeta[]> => {
			const { rows, describe } = await this.runShowQuery(`SHOW FIELDS FROM ${target}`, referenceId);
			const typesByName = describeFieldTypes(describe);
			return rows
				.map((row) => {
					const name = stringOrUndefined(row['name']) ?? '';
					return {
						name,
						// Prefer the authoritative type from queryDescribe; fall back to any type column the
						// SHOW row itself carries.
						type: typesByName.get(name) ?? stringOrUndefined(row['type']),
						label: displayLabel(name, stringOrUndefined(row['label'])),
						relationship_name: stringOrUndefined(row['relationship_name']),
					};
				})
				.filter((field) => field.name.length > 0);
		},

		/**
		 * `SHOW RELATIONSHIPS FROM <target>` — a target's relationships for the VQL Builder. Each row
		 * carries `name` (the relationship name used in VQL), `target` (the related query target), and
		 * `type` (`outbound` = parent lookup / dot traversal, `inbound` = child / subquery). Runs through
		 * the latest-version `/query` endpoint like the other SHOW queries.
		 */
		showRelationships: async (
			target: string,
			referenceId: ToolboxFeatureArea,
		): Promise<VaultRelationshipMeta[]> => {
			const { rows } = await this.runShowQuery(`SHOW RELATIONSHIPS FROM ${target}`, referenceId);
			return rows
				.map((row) => ({
					name: stringOrUndefined(row['name']) ?? '',
					target: stringOrUndefined(row['target']) ?? '',
					type: stringOrUndefined(row['type']) ?? '',
				}))
				.filter((relationship) => relationship.name.length > 0);
		},
	};

	// ── Metadata ──────────────────────────────────────────────────────────────

	readonly metadata = {
		/**
		 * GET /api/{v}/metadata/vobjects — the configurable-object list (standard, custom, and system
		 * objects). Membership here is the reliable "is this a real configurable object" signal the VQL
		 * Builder uses to decide a relationship's field vocabulary: present → the hardcoded standard field
		 * table applies; absent (a query-only target `SHOW TARGETS` lists but that is not a real object,
		 * e.g. `job_instance__sys`) → resolve its real `SHOW FIELDS`. One bulk call per vault, cacheable
		 * like `SHOW TARGETS`. Latest-version, like the other metadata calls, so a pinned {@link apiVersion}
		 * never governs it. Only `name` + `source` are kept; the rest of each row is dropped.
		 */
		listConfigurableObjects: async (
			referenceId: ToolboxFeatureArea,
		): Promise<VaultObjectMetadataSummary[]> => {
			const res = await this.send({
				url: `${this.apiBase(this.latestApiVersion)}/metadata/vobjects`,
				method: 'GET',
				headers: this.headers(referenceId),
			});
			const body = this.expectSuccess(res);
			const objects = Array.isArray(body['objects']) ? (body['objects'] as unknown[]) : [];
			return objects
				.map((entry) => {
					const object = (entry ?? {}) as Record<string, unknown>;
					return {
						name: stringOrUndefined(object['name']) ?? '',
						source: stringOrUndefined(object['source']),
					};
				})
				.filter((object) => object.name.length > 0);
		},

		/**
		 * GET /api/{v}/objects/picklists — Retrieve All Picklists. The one documented REST exception to the
		 * VQL Builder's "SHOW everywhere" charter: `SHOW FIELDS` names picklist fields but exposes no
		 * values, and there is no SHOW path to them. This vault-wide call's `usedIn[]` entries reverse-map
		 * to a field→picklistName index (see `picklistIndex.ts`); a field's picklist-ness is decided by
		 * presence in that index, not by a `SHOW FIELDS` type string. Runs against the latest API version,
		 * like the SHOW metadata calls, so a pinned {@link apiVersion} never governs it.
		 */
		retrieveAllPicklists: async (
			referenceId: ToolboxFeatureArea,
		): Promise<VaultPicklistSummary[]> => {
			const res = await this.send({
				url: `${this.apiBase(this.latestApiVersion)}/objects/picklists`,
				method: 'GET',
				headers: this.headers(referenceId),
			});
			const body = this.expectSuccess(res);
			const picklists = Array.isArray(body['picklists'])
				? (body['picklists'] as unknown[])
				: [];
			return picklists.map(mapPicklistSummary).filter((picklist) => picklist.name.length > 0);
		},

		/**
		 * GET /api/{v}/metadata/components — Retrieve All Component Metadata: the list of all component
		 * types this Vault supports. Filtered to `active: true` entries; returns each type's `name` (the
		 * value used in MDL commands and Config Report parameters). Latest-version, like the other
		 * metadata calls, so a pinned {@link apiVersion} never governs it.
		 */
		retrieveAllComponentTypes: async (referenceId: ToolboxFeatureArea): Promise<string[]> => {
			const res = await this.send({
				url: `${this.apiBase(this.latestApiVersion)}/metadata/components`,
				method: 'GET',
				headers: this.headers(referenceId),
			});
			const body = this.expectSuccess(res);
			const data = Array.isArray(body['data']) ? (body['data'] as unknown[]) : [];
			return data
				.map((entry) => {
					const component = (entry ?? {}) as Record<string, unknown>;
					return { name: stringOrUndefined(component['name']) ?? '', active: component['active'] === true };
				})
				.filter((component) => component.active && component.name.length > 0)
				.map((component) => component.name)
				.sort();
		},

		/**
		 * GET /api/{v}/objects/picklists/{picklist_name} — Retrieve Picklist Values, fetched lazily per
		 * picklist name when a picklist field enters the WHERE builder. Returns each active value's `name`
		 * (written into VQL) and `label` (shown in the dropdown). Latest-version, like the other metadata
		 * calls. `controllingPicklistName`/`picklistDependencies` (dependent picklists) are ignored in v1.
		 */
		retrievePicklistValues: async (
			picklistName: string,
			referenceId: ToolboxFeatureArea,
		): Promise<VaultPicklistValue[]> => {
			const res = await this.send({
				url: `${this.apiBase(this.latestApiVersion)}/objects/picklists/${encodeURIComponent(picklistName)}`,
				method: 'GET',
				headers: this.headers(referenceId),
			});
			const body = this.expectSuccess(res);
			const values = Array.isArray(body['picklistValues'])
				? (body['picklistValues'] as Array<Record<string, unknown>>)
				: [];
			return values
				.map((value) => ({
					name: stringOrUndefined(value['name']) ?? '',
					label: stringOrUndefined(value['label']),
				}))
				.filter((value) => value.name.length > 0);
		},
	};

	// ── MDL ───────────────────────────────────────────────────────────────────

	readonly mdl = {
		/**
		 * POST /api/mdl/execute — the synchronous MDL Execute operation (the "Deploy to Vault" / "Drop
		 * from Vault" actions; see ADR 0005). The raw MDL script is the request body.
		 *
		 * Unlike the other methods, this deliberately does NOT funnel through the throwing
		 * `expectSuccess`: a non-session FAILURE envelope (e.g. an MDL syntax error) is a normal outcome
		 * the caller must render, so it is parsed and returned. Only an `INVALID_SESSION_ID` FAILURE is
		 * re-thrown as a `VaultApiError`, so `ConnectionManager.run`'s session-recovery retry still fires.
		 * Transport faults (timeout, network) continue to throw from the transport.
		 */
		executeMdl: async (
			script: string,
			referenceId: ToolboxFeatureArea,
		): Promise<MdlExecuteResult> => {
			const res = await this.send({
				// The MDL Execute endpoint is version-less (`/api/mdl/execute`, no `/{version}` segment),
				// unlike the query/metadata endpoints — verified against the v26.1 REST reference.
				url: `https://${this.vaultDNS}/api/mdl/execute`,
				method: 'POST',
				headers: this.headers(referenceId, {
					[HEADER_CONTENT_TYPE]: JSON_CONTENT_TYPE,
					[HEADER_ACCEPT]: JSON_CONTENT_TYPE,
				}),
				body: script,
			});

			const body = res.body;
			if (!isVaultResponse(body)) {
				throw new VaultApiError(`Unexpected response (HTTP ${res.status})`);
			}
			if (isFailure(body) && isInvalidSession(body)) {
				throw failureApiError(body, res.status, 'INVALID_SESSION_ID');
			}
			return parseMdlExecuteResult(body as VaultResponse & Record<string, unknown>);
		},

		/**
		 * Pull **every** component's MDL from this Vault for a Compare Environments comparison: run the
		 * Component Definition Query (see CONTEXT.md) and follow `next_page` to accumulate all rows across
		 * pages. Rows whose `mdl_definition__v` is `N/A` — the code component types with no MDL body — are
		 * dropped, so only components that actually have MDL come back. `isCancelled` is polled between
		 * pages so a long pull against a large Vault can be aborted; the partial result the caller discards
		 * on cancellation is never used.
		 */
		fetchComponentDefinitions: async (
			referenceId: ToolboxFeatureArea,
			isCancelled?: () => boolean,
		): Promise<ComponentDefinition[]> => {
			const first = await this.vql.queryComponents(COMPONENT_DEFINITION_SELECT, referenceId);
			const rows = await this.accumulateQueryRows(first, referenceId, isCancelled);
			return rows
				.map(toComponentDefinition)
				.filter((component): component is ComponentDefinition => component !== undefined);
		},

		/**
		 * Re-read a single component's MDL from this Vault via the Component Definition Query scoped by
		 * type + name, used after an apply to recompute one entry's status. Returns the definition, or
		 * `undefined` when the component no longer exists (e.g. just dropped) or has no MDL body. Reusing
		 * the same query as {@link fetchComponentDefinitions} guarantees the re-read `mdl_definition__v` is
		 * byte-comparable with the rest of the comparison.
		 */
		retrieveComponentDefinition: async (
			componentType: string,
			componentName: string,
			referenceId: ToolboxFeatureArea,
		): Promise<ComponentDefinition | undefined> => {
			const vql =
				`${COMPONENT_DEFINITION_SELECT} WHERE component_type__v = '${escapeVqlString(componentType)}' ` +
				`AND component_name__v = '${escapeVqlString(componentName)}'`;
			const result = await this.vql.queryComponents(vql, referenceId);
			for (const row of result.data) {
				const component = toComponentDefinition(row);
				if (component) {
					return component;
				}
			}
			return undefined;
		},
	};

	// ── Job ───────────────────────────────────────────────────────────────────

	readonly job = {
		/**
		 * POST /api/{v}/objects/vault/actions/configreport — submit a Vault Configuration Report job. The
		 * form-encoded `body` is the parameter map from `encodeConfigReportBody`. Returns the async `job_id`
		 * to poll with {@link job.retrieveJobStatus}. This is the repo's first job-submitting call (see ADR 0007).
		 */
		submitConfigReport: async (
			body: Record<string, string>,
			referenceId: ToolboxFeatureArea,
		): Promise<number> => {
			const res = await this.send({
				url: `${this.apiBase()}/objects/vault/actions/configreport`,
				method: 'POST',
				headers: this.formHeaders(referenceId),
				body: new URLSearchParams(body),
			});
			const parsed = this.expectSuccess(res);
			const jobId = parsed['job_id'];
			if (typeof jobId !== 'number') {
				throw new VaultApiError('Configuration Report submission returned no job id');
			}
			return jobId;
		},

		/**
		 * GET /api/{v}/services/jobs/{job_id} — poll an async job's status. Returns the raw Vault `status`
		 * string (classified by `decideJobAction`) plus the `data.links` download hrefs, which are populated
		 * only once the job finishes. Vault rate-limits this endpoint to once per 10s per job, so the poll
		 * cadence stays at the documented 11s.
		 */
		retrieveJobStatus: async (
			jobId: number,
			referenceId: ToolboxFeatureArea,
		): Promise<JobStatus> => {
			const res = await this.send({
				url: `${this.apiBase()}/services/jobs/${jobId}`,
				method: 'GET',
				headers: this.headers(referenceId, { [HEADER_ACCEPT]: JSON_CONTENT_TYPE }),
			});
			const body = this.expectSuccess(res);
			const data = (body['data'] ?? {}) as Record<string, unknown>;
			const rawLinks = Array.isArray(data['links']) ? (data['links'] as unknown[]) : [];
			const links = rawLinks
				.map((entry) => {
					const link = (entry ?? {}) as Record<string, unknown>;
					return {
						rel: stringOrUndefined(link['rel']) ?? '',
						href: stringOrUndefined(link['href']) ?? '',
					};
				})
				.filter((link) => link.href.length > 0);
			return { status: stringOrUndefined(data['status']) ?? '', links };
		},

		/**
		 * GET a job artifact as raw bytes (the report ZIP or the CSV error log), resolving a Vault-relative
		 * href against this Vault's origin. Uses `responseType: 'binary'` so the transport keeps the bytes;
		 * a non-2xx response decodes as a JSON envelope and is thrown via {@link expectSuccess}, so an expired
		 * session still triggers `ConnectionManager`'s re-auth retry.
		 */
		downloadJobArtifact: async (
			href: string,
			referenceId: ToolboxFeatureArea,
		): Promise<Uint8Array> => {
			const res = await this.send({
				url: this.resolvePageUrl(href),
				method: 'GET',
				headers: this.headers(referenceId),
				responseType: 'binary',
			});
			if (res.body instanceof Uint8Array) {
				return res.body;
			}
			this.expectSuccess(res); // a non-binary body is an error envelope — throw it
			throw new VaultApiError('Artifact download did not return binary content');
		},
	};

	// ── SDK Code ──────────────────────────────────────────────────────────────

	readonly sdk = {
		/**
		 * GET /api/{v}/code/{className} — retrieve one custom Vault Java SDK class's source. On success the
		 * endpoint returns the raw `.java` file; `className` is the `component_name__v` verbatim (a dotted
		 * fully-qualified name that needs no path transform or extra URL-encoding). Uses `responseType: 'binary'`
		 * so the transport keeps the raw bytes on a 2xx, decoded here as UTF-8 text.
		 *
		 * Unlike the other binary endpoints, `/code` returns a FAILURE envelope with **HTTP 200** (e.g.
		 * `File not found.` for a listed component whose source isn't retrievable), so a 2xx binary body can be
		 * a JSON error rather than source — writing it verbatim would produce a `.java` file full of the error
		 * envelope. Real `.java` source is never a JSON object, so we parse-and-check: only a FAILURE envelope
		 * throws (letting the caller record + skip it, and an `INVALID_SESSION_ID` envelope still trigger
		 * `ConnectionManager`'s re-auth retry); anything that isn't one is returned verbatim as source.
		 */
		retrieveSourceCode: async (
			className: string,
			referenceId: ToolboxFeatureArea,
		): Promise<string> => {
			const res = await this.send({
				url: `${this.apiBase()}/code/${className}`,
				method: 'GET',
				headers: this.headers(referenceId),
				responseType: 'binary',
			});
			if (res.body instanceof Uint8Array) {
				const text = new TextDecoder().decode(res.body);
				const parsed = tryParseJson(text);
				if (isVaultResponse(parsed) && isFailure(parsed)) {
					throw failureApiError(parsed, res.status, 'FAILURE');
				}
				return text;
			}
			this.expectSuccess(res); // a non-binary body is an error envelope — throw it
			throw new VaultApiError('Source code retrieval did not return file content');
		},

		/**
		 * PUT /api/{v}/code — add or replace one custom Vault Java SDK source file (**Deploy Java SDK
		 * Code**). The `.java` source is uploaded as a `multipart/form-data` `file` field (`fileName`
		 * becomes the multipart filename); Vault derives the fully-qualified class name from the source's
		 * `package` declaration and echoes it back as `url`, which the success summary surfaces.
		 *
		 * Like {@link mdl.executeMdl}, this deliberately does NOT funnel through the throwing
		 * `expectSuccess`: a non-session FAILURE envelope (e.g. non-custom code, or a source file over the
		 * 1 MB limit) is a normal outcome the caller renders. Only an `INVALID_SESSION_ID` FAILURE is
		 * re-thrown (so `ConnectionManager.run`'s session-recovery retry still fires).
		 */
		addOrReplaceSourceCode: async (
			fileName: string,
			bytes: Uint8Array,
			referenceId: ToolboxFeatureArea,
		): Promise<SdkCodeResult> => {
			const multipart = encodeMultipartFormData([{ name: 'file', filename: fileName, data: bytes }]);
			const res = await this.send({
				url: `${this.apiBase()}/code`,
				method: 'PUT',
				headers: this.headers(referenceId, {
					[HEADER_CONTENT_TYPE]: multipart.contentType,
					[HEADER_ACCEPT]: JSON_CONTENT_TYPE,
				}),
				body: multipart.body,
			});
			return this.parseSdkCodeResult(res);
		},

		/**
		 * DELETE /api/{v}/code/{className} — remove one custom Vault Java SDK source file (**Delete Java
		 * SDK Code**). `className` is the fully-qualified class name derived locally from the file's
		 * `package` declaration plus its filename. Sent with no body.
		 *
		 * Like {@link sdk.addOrReplaceSourceCode}, this deliberately does NOT funnel through the throwing
		 * `expectSuccess`: a non-session FAILURE envelope is a normal outcome the caller renders. Only an
		 * `INVALID_SESSION_ID` FAILURE is re-thrown.
		 */
		deleteSourceCode: async (
			className: string,
			referenceId: ToolboxFeatureArea,
		): Promise<SdkCodeResult> => {
			const res = await this.send({
				url: `${this.apiBase()}/code/${className}`,
				method: 'DELETE',
				headers: this.headers(referenceId, { [HEADER_ACCEPT]: JSON_CONTENT_TYPE }),
			});
			return this.parseSdkCodeResult(res);
		},
	};

	// ── Developer Logs ────────────────────────────────────────────────────────

	readonly logs = {
		/**
		 * GET /api/{v}/logs/api_usage?date=&log_format= — download the API Usage Log for one UTC calendar
		 * day as a ZIP (`application/octet-stream`). Synchronous: unlike the Configuration Report there is no
		 * job to submit or poll. `query` is the parameter map from `encodeApiUsageLogQuery`. Uses
		 * `responseType: 'binary'` so the transport keeps the bytes; a non-2xx response decodes as a JSON
		 * envelope and is thrown via {@link expectSuccess}, so an expired session still triggers
		 * `ConnectionManager`'s re-auth retry.
		 */
		downloadApiUsageLog: async (
			query: Record<string, string>,
			referenceId: ToolboxFeatureArea,
		): Promise<Uint8Array> => {
			const search = new URLSearchParams(query).toString();
			const res = await this.send({
				url: `${this.apiBase()}/logs/api_usage?${search}`,
				method: 'GET',
				headers: this.headers(referenceId),
				responseType: 'binary',
			});
			if (res.body instanceof Uint8Array) {
				return res.body;
			}
			this.expectSuccess(res); // a non-binary body is an error envelope — throw it
			throw new VaultApiError('API Usage Log download did not return binary content');
		},

		/**
		 * GET /api/{v}/logs/code/runtime?date=&log_format= — download the Vault Java SDK Runtime Log for
		 * one UTC calendar day as a ZIP (`application/octet-stream`). Synchronous: unlike the Configuration
		 * Report there is no job to submit or poll. `query` is the parameter map from
		 * `encodeSdkRuntimeLogQuery`. Uses `responseType: 'binary'` so the transport keeps the bytes; a
		 * non-2xx response decodes as a JSON envelope and is thrown via {@link expectSuccess}, so an expired
		 * session still triggers `ConnectionManager`'s re-auth retry.
		 */
		downloadSdkRuntimeLog: async (
			query: Record<string, string>,
			referenceId: ToolboxFeatureArea,
		): Promise<Uint8Array> => {
			const search = new URLSearchParams(query).toString();
			const res = await this.send({
				url: `${this.apiBase()}/logs/code/runtime?${search}`,
				method: 'GET',
				headers: this.headers(referenceId),
				responseType: 'binary',
			});
			if (res.body instanceof Uint8Array) {
				return res.body;
			}
			this.expectSuccess(res); // a non-binary body is an error envelope — throw it
			throw new VaultApiError('SDK Runtime Log download did not return binary content');
		},
	};
}

// ── Module-private helpers ────────────────────────────────────────────────────

/** Pick the highest `vMAJOR.MINOR` key from a Retrieve API Versions `values` map. */
export function pickLatestApiVersion(values: Record<string, string>): string {
	let best: string | undefined;
	let bestMajor = -1;
	let bestMinor = -1;
	for (const key of Object.keys(values)) {
		const versionMatch = /^v(\d+)\.(\d+)$/.exec(key);
		if (!versionMatch) {
			continue;
		}
		const major = Number(versionMatch[1]);
		const minor = Number(versionMatch[2]);
		if (major > bestMajor || (major === bestMajor && minor > bestMinor)) {
			bestMajor = major;
			bestMinor = minor;
			best = key;
		}
	}
	if (!best) {
		throw new VaultApiError('No recognizable API versions returned by Vault');
	}
	return best;
}

/** Parse `text` as JSON, returning `undefined` when it isn't JSON at all (e.g. raw `.java` source). */
function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** Build a `VaultApiError` from a FAILURE envelope: `type: message`, falling back to `defaultType`
 * and the raw-body message, and carrying the envelope as the error `response`. */
function failureApiError(body: VaultResponse, status: number, defaultType: string): VaultApiError {
	const type = body.errors?.[0]?.type ?? defaultType;
	const message = firstErrorMessage(body) ?? rawFailureMessage(body, status);
	return new VaultApiError(`${type}: ${message}`, type, body as unknown as Record<string, unknown>);
}

/** Fallback message for a FAILURE envelope carrying no `errors`/`responseMessage` — include the raw
 * body (truncated) so an otherwise-opaque failure is diagnosable. */
function rawFailureMessage(body: unknown, status: number): string {
	let raw: string;
	try {
		raw = JSON.stringify(body);
	} catch {
		raw = String(body);
	}
	return `Request failed (HTTP ${status}): ${raw.slice(0, MAX_ERROR_BODY_CHARS)}`;
}

/** Parse an MDL Execute envelope into an `MdlExecuteResult`, mapping Vault's snake_case detail. */
function parseMdlExecuteResult(body: VaultResponse & Record<string, unknown>): MdlExecuteResult {
	const rawScript = body['script_execution'];
	const scriptExecution =
		typeof rawScript === 'object' && rawScript !== null
			? mapScriptExecution(rawScript as Record<string, unknown>)
			: undefined;
	const rawStatements = Array.isArray(body['statement_execution'])
		? (body['statement_execution'] as Array<Record<string, unknown>>)
		: [];
	return {
		responseStatus: body.responseStatus,
		scriptExecution,
		statements: rawStatements.map(mapStatementResult),
		errors: body.errors,
	};
}

function mapScriptExecution(raw: Record<string, unknown>): MdlScriptExecution {
	return {
		code: stringOrUndefined(raw['code']),
		message: stringOrUndefined(raw['message']),
		warnings: numberOrUndefined(raw['warnings']),
		failures: numberOrUndefined(raw['failures']),
		exceptions: numberOrUndefined(raw['exceptions']),
		componentsAffected: numberOrUndefined(raw['components_affected']),
		executionTime: numberOrUndefined(raw['execution_time']),
	};
}

function mapStatementResult(raw: Record<string, unknown>): MdlStatementResult {
	return {
		statement: numberOrUndefined(raw['statement']),
		command: stringOrUndefined(raw['command']),
		component: stringOrUndefined(raw['component']),
		message: stringOrUndefined(raw['message']),
		response: stringOrUndefined(raw['response']),
	};
}

/** Map one raw `vaults__v` entry to a DomainVault, guarding each nested shape. */
function mapDomainVault(raw: unknown): DomainVault {
	const vault = raw as Record<string, unknown>;
	const family = vault['vault_family__v'] as Record<string, unknown> | undefined;
	const applications = Array.isArray(vault['vault_application__v'])
		? (vault['vault_application__v'] as Array<Record<string, unknown>>)
		: [];
	return {
		id: numberOrUndefined(vault['id']) ?? 0,
		name: stringOrUndefined(vault['vault_name__v']) ?? '',
		status: stringOrUndefined(vault['vault_status__v']),
		familyLabel: family ? stringOrUndefined(family['label__v']) : undefined,
		applications: applications
			.map((application) => stringOrUndefined(application['label']) ?? '')
			.filter(Boolean),
	};
}

/** Map one raw Retrieve All Picklists entry to a `VaultPicklistSummary`, keeping only its `usedIn`
 *  entries that carry a `propertyName` (the ones the field→picklistName reverse-map can use). */
function mapPicklistSummary(raw: unknown): VaultPicklistSummary {
	const picklist = (raw ?? {}) as Record<string, unknown>;
	const rawUsedIn = Array.isArray(picklist['usedIn']) ? (picklist['usedIn'] as unknown[]) : [];
	const usedIn = rawUsedIn
		.map((entry) => {
			const usage = (entry ?? {}) as Record<string, unknown>;
			return {
				objectName: stringOrUndefined(usage['objectName']),
				documentTypeName: stringOrUndefined(usage['documentTypeName']),
				propertyName: stringOrUndefined(usage['propertyName']),
			};
		})
		.filter((usage) => Boolean(usage.propertyName));
	return {
		name: stringOrUndefined(picklist['name']) ?? '',
		label: stringOrUndefined(picklist['label']),
		usedIn,
	};
}

/** Index a `SHOW FIELDS` response's `queryDescribe` fields as name → type (types the rows lack). */
function describeFieldTypes(describe: QueryDescribe | undefined): Map<string, string> {
	const typesByName = new Map<string, string>();
	for (const field of describe?.fields ?? []) {
		if (field.type) {
			typesByName.set(field.name, field.type);
		}
	}
	return typesByName;
}

/**
 * Map one Component Definition Query row to a {@link ComponentDefinition}, or `undefined` when it
 * carries no usable MDL — a missing name/type, or the `N/A` sentinel used for code component types.
 */
function toComponentDefinition(row: QueryRow): ComponentDefinition | undefined {
	const type = stringOrUndefined(row['component_type__v']);
	const name = stringOrUndefined(row['component_name__v']);
	const mdl = stringOrUndefined(row['mdl_definition__v']);
	if (!type || !name || !mdl || mdl === NO_MDL_DEFINITION) {
		return undefined;
	}
	return { type, name, mdl };
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** Escape a value for a single-quoted VQL string literal (backslash then quote), as VQL filters do. */
function escapeVqlString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** The `q=<vql>` form body every `/query` POST sends. */
function vqlQueryBody(vql: string): URLSearchParams {
	const body = new URLSearchParams();
	body.append('q', vql);
	return body;
}

function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}
