/**
 * How an Environment authenticates to its Vault (see ADR 0002): Basic (user name/password), a
 * directly-supplied Session ID, or an API Access Token (sent as `Authorization: Bearer {token}`).
 */
export enum AuthType {
	Basic = 'BASIC',
	SessionId = 'SESSION_ID',
	ApiAccessToken = 'API_ACCESS_TOKEN',
}

/**
 * A saved, named Vault connection. Only non-secret fields live here — the password or
 * session ID is held separately in SecretStorage (see CredentialStore).
 */
export interface Environment {
	/** Stable identifier; also the key into SecretStorage. */
	id: string;
	/**
	 * User-facing display name. Auto-seeded from the DNS on add, then replaced by the Vault's own
	 * reported name on first connect — unless {@link hasCustomLabel} is set, in which case this is a
	 * user-supplied name that must not be overwritten on connect.
	 */
	label: string;
	/**
	 * True when the user explicitly provided a label. Suppresses the auto-adopt-on-connect behaviour
	 * so the user's chosen name is never silently overwritten.
	 */
	hasCustomLabel?: boolean;
	/** Bare Vault hostname, lowercased (e.g. "myvault.veevavault.com"). */
	vaultDNS: string;
	/** Present for Basic auth; absent for Session-ID auth. */
	username?: string;
	authType: AuthType;
}

/** Lowercase and trim a DNS/host value; strips any scheme or trailing slash if pasted. */
export function normalizeDns(input: string): string {
	return input
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();
}

/**
 * Normalize the non-secret fields and enforce the invariant that `username` exists only for Basic
 * auth (a Session-ID env must not carry a stray username). Shared by create and edit so both apply
 * it — previously only `edit` gated the username.
 */
function shapeEnvironmentFields(fields: Omit<Environment, 'id'>): Omit<Environment, 'id'> {
	return {
		label: fields.label,
		hasCustomLabel: fields.hasCustomLabel,
		vaultDNS: normalizeDns(fields.vaultDNS),
		username: fields.authType === AuthType.Basic ? fields.username : undefined,
		authType: fields.authType,
	};
}

/** Build a new Environment with a generated id and normalized, invariant-checked fields. */
export function createEnvironment(fields: Omit<Environment, 'id'>): Environment {
	// Web Crypto's randomUUID (a global in the extension host's Node runtime and in browsers) keeps
	// this domain model free of a `node:`-only import, so the webview bundle can import AuthType.
	return { id: crypto.randomUUID(), ...shapeEnvironmentFields(fields) };
}

/** Re-shape an edited Environment's non-secret fields, preserving its existing id. */
export function updateEnvironment(id: string, fields: Omit<Environment, 'id'>): Environment {
	return { id, ...shapeEnvironmentFields(fields) };
}
