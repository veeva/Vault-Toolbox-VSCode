/**
 * Transport + response types for the Vault REST client. The client depends on the
 * `HttpTransport` interface (not on global fetch) so it can be unit-tested with a fake.
 */

export interface HttpRequest {
	url: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	headers?: Record<string, string>;
	/**
	 * Request body: a JSON/text string, form-urlencoded params, or raw bytes (a `Uint8Array`, used for
	 * the `multipart/form-data` SDK-code upload built by `encodeMultipartFormData`).
	 */
	body?: string | URLSearchParams | Uint8Array;
	/**
	 * How to decode the response body. `binary` returns the raw bytes as a `Uint8Array` in
	 * {@link VaultHttpResponse.body} on a 2xx (for artifact downloads); a non-2xx still decodes as a JSON
	 * Vault envelope so failures surface normally. Defaults to `json`.
	 */
	responseType?: 'json' | 'binary';
}

export interface VaultHttpResponse {
	status: number;
	getHeader(name: string): string | undefined;
	/** All response headers as a plain lowercased-key map, for callers (e.g. API History) that need
	 * to enumerate them rather than look one up by name. */
	headers: Record<string, string>;
	/**
	 * Parsed JSON body (Vault returns JSON even for logical failures), or a `Uint8Array` of raw bytes
	 * when the request set `responseType: 'binary'` and the response was a 2xx.
	 */
	body: unknown;
}

export interface HttpTransport {
	/** `timeoutMs` aborts the request after that many ms; omit it to wait indefinitely for Vault. */
	send(req: HttpRequest, timeoutMs?: number): Promise<VaultHttpResponse>;
}

/** The common Vault response envelope. `WARNING` carries valid data (see `isFailure`). */
export interface VaultResponse {
	responseStatus: 'SUCCESS' | 'WARNING' | 'FAILURE' | 'EXCEPTION' | string;
	responseMessage?: string;
	errors?: VaultError[];
	warnings?: VaultError[];
}

export interface VaultError {
	type: string;
	message: string;
}

/** Result of a successful Basic authentication. */
export interface AuthResult {
	sessionId: string;
	userId?: number;
	vaultId?: number;
	vaultIds: Array<{ id: number; name: string; url: string }>;
}

export interface VaultUser {
	id?: number;
	userName?: string;
	firstName?: string;
	lastName?: string;
	email?: string;
	/** Vault id from the response header, when present. */
	vaultId?: number;
}

export interface DomainVault {
	id: number;
	name: string;
	status?: string;
	familyLabel?: string;
	applications: string[];
}

export interface DomainInfo {
	domainName?: string;
	domainType?: string;
	vaults: DomainVault[];
}

/** Summary of a Vault query target from `SHOW TARGETS` (used for VQL FROM completion). */
export interface VaultObjectSummary {
	name: string;
	label?: string;
	label_plural?: string;
}

/**
 * One row of `GET /metadata/vobjects` — the configurable-object list. Distinct from
 * {@link VaultObjectSummary} (a `SHOW TARGETS` query target): the two lists mean different things, and
 * conflating them is exactly the bug this type exists to avoid. Membership here is the reliable "is
 * this a real configurable object" signal the VQL Builder uses to choose a relationship's field
 * vocabulary — present → the standard field set applies (every configurable object carries it,
 * regardless of `source`); absent (a query-only target like `job_instance__sys`) → its real
 * `SHOW FIELDS` must be resolved. Only `name` (for membership) and `source` (retained for future use)
 * are kept.
 */
export interface VaultObjectMetadataSummary {
	name: string;
	source?: string;
}

/**
 * A single field's metadata from `SHOW FIELDS FROM <target>` (used for VQL SELECT/WHERE field
 * completion). `type` is read from the response's `queryDescribe` block; `relationship_name` is
 * present only for reference fields.
 */
export interface VaultFieldMeta {
	name: string;
	type?: string;
	label?: string;
	relationship_name?: string;
}

/**
 * One relationship of a query target from `SHOW RELATIONSHIPS FROM <target>` (used by the VQL Builder
 * to offer parent traversal and child subqueries). `name` is the relationship name referenced in VQL
 * (`rel__cr.field` for outbound, `SELECT … FROM rel__cr` for inbound); `target` is the related query
 * target; `type` is `outbound` (parent lookup → dot traversal) or `inbound` (child → subquery).
 */
export interface VaultRelationshipMeta {
	name: string;
	target: string;
	type: string;
}

/**
 * One `usedIn[]` entry from Retrieve All Picklists — where a picklist is referenced. Exactly one of
 * `objectName` (object picklists) / `documentTypeName` (document picklists) is present, paired with
 * `propertyName` (the object field or document field that uses the picklist). The VQL Builder
 * reverse-maps these into its field→picklistName index.
 */
export interface VaultPicklistUsage {
	objectName?: string;
	documentTypeName?: string;
	propertyName?: string;
}

/**
 * One picklist from Retrieve All Picklists (`GET /objects/picklists`). `usedIn` is the reverse-map
 * source: which object/document fields reference this picklist. Only the fields the VQL Builder needs
 * are kept (name + label + usedIn); `kind`/`system`/`systemManaged` are ignored.
 */
export interface VaultPicklistSummary {
	name: string;
	label?: string;
	usedIn: readonly VaultPicklistUsage[];
}

/** One picklist value from Retrieve Picklist Values: the API `name` (written into VQL) + its `label`
 *  (shown in the WHERE builder's value dropdown). */
export interface VaultPicklistValue {
	name: string;
	label?: string;
}

/** A single VQL result row: field name → scalar, multi-value array, or a nested subquery object. */
export type QueryRow = Record<string, unknown>;

/**
 * Shape of a subquery field's value nested inside a `QueryRow`. Unlike the outer envelope, this
 * value passes through unparsed, so it carries Vault's raw (snake_case) field names.
 */
export interface SubqueryValue {
	data?: QueryRow[];
	responseDetails?: {
		size?: number;
		total?: number;
		next_page?: string;
		previous_page?: string;
	};
}

export interface QueryDescribeField {
	name: string;
	type?: string;
}

/** One subquery's field list, keyed by its relationship name (or `alias` when the VQL used one). */
export interface QueryDescribeSubquery {
	relationship?: string;
	alias?: string;
	fields: QueryDescribeField[];
}

/** Vault's query-describe payload, present when `X-VaultAPI-DescribeQuery: true` was sent. */
export interface QueryDescribe {
	object?: { name?: string };
	fields?: QueryDescribeField[];
	subqueries?: QueryDescribeSubquery[];
}

/** Pagination + counts from a query's `responseDetails` (snake_case mapped to camelCase). */
export interface QueryResponseDetails {
	pagesize?: number;
	pageoffset?: number;
	size?: number;
	total?: number;
	/** Relative URL to POST for the next page; absent for the last page and some query targets. */
	nextPage?: string;
	/** Relative URL to POST for the previous page; absent on the first page and some targets. */
	previousPage?: string;
}

/** Parsed result of a VQL query. `queryDescribe` is only sent on the initial page (see `queryByPage`). */
export interface QueryResult {
	data: QueryRow[];
	responseDetails: QueryResponseDetails;
	queryDescribe?: QueryDescribe;
	/** The untouched response body, in the order Vault returned it. Rendered by the JSON view. */
	raw: Record<string, unknown>;
}

/** Options for the paginated `vql.queryPages` / `vql.queryAll` pulls. */
export interface QueryPageOptions {
	/**
	 * Which endpoint runs the first page: the standard `/query` (default) or the `/query/components`
	 * Component Definition Query, which returns each component's `mdl_definition__v`. Continuation pages
	 * always follow `next_page` regardless of this choice.
	 */
	target?: 'query' | 'components';
	/**
	 * Polled between pages so a long pull can be stopped; once it returns true no further page is
	 * fetched and the rows gathered so far are what the caller receives.
	 */
	isCancelled?: () => boolean;
}

/**
 * The `script_execution` summary from an MDL Execute response (snake_case mapped to camelCase).
 * Counts are optional because a malformed envelope may omit them; a missing count is treated as
 * zero by the outcome classifier.
 */
export interface MdlScriptExecution {
	code?: string;
	message?: string;
	warnings?: number;
	failures?: number;
	exceptions?: number;
	componentsAffected?: number;
	executionTime?: number;
}

/** One entry from an MDL Execute `statement_execution` array (one per MDL statement in the script). */
export interface MdlStatementResult {
	statement?: number;
	command?: string;
	component?: string;
	message?: string;
	/** Per-statement outcome — `SUCCESS` for a statement that applied cleanly. */
	response?: string;
}

/**
 * Parsed result of an MDL Execute (`/mdl/execute`) call. Carries the envelope status plus Vault's
 * per-script and per-statement detail so the outcome can be classified and rendered — returned for
 * both a SUCCESS envelope and a non-session FAILURE envelope (so MDL syntax errors survive).
 */
export interface MdlExecuteResult {
	responseStatus: string;
	scriptExecution?: MdlScriptExecution;
	statements: MdlStatementResult[];
	/** Envelope-level errors (e.g. on a FAILURE envelope with no statement detail). */
	errors?: VaultError[];
}

/**
 * Parsed result of a Vault Java SDK `/code` write or delete (`addOrReplaceSourceCode` /
 * `deleteSourceCode`). Carries the envelope status plus, on a deploy success, the fully-qualified class
 * name Vault derived (`url`). Returned for both a SUCCESS envelope and a non-session FAILURE envelope,
 * so Vault's own error (e.g. non-custom code, or a component currently in use) is surfaced verbatim;
 * only an expired-session FAILURE is re-thrown so the connection's re-auth retry still fires.
 */
export interface SdkCodeResult {
	responseStatus: string;
	responseMessage?: string;
	/** The fully-qualified class name Vault recorded, echoed as `url` on a deploy success. */
	url?: string;
	/** Envelope-level errors on a FAILURE envelope, when present. */
	errors?: VaultError[];
}

/**
 * Closed set of feature areas that can trigger a Vault API call, sent verbatim as the
 * `X-VaultAPI-ReferenceID` header so Vault's API Usage Log can be broken down per feature. Every
 * `VaultClient` request method requires one of these — see `docs/features/reference-id-header/SPEC.md`.
 */
export type ToolboxFeatureArea =
	| 'toolbox-actions-vault-compare'
	| 'toolbox-vql-editor'
	| 'toolbox-authentication'
	| 'toolbox-actions-mdl'
	| 'toolbox-actions-sdk'
	| 'toolbox-actions-config-report'
	| 'toolbox-actions-config-report-types'
	| 'toolbox-actions-developer-logs';
