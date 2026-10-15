import type { AuthType } from '../core/models/environment';

/**
 * Typed message protocol for the Environments tab of the unified sidebar webview ⇄ extension host,
 * carried on the `environments` channel of the shell envelope. Kept vscode-free and DOM-free so both
 * the host (`EnvironmentsBus`) and the webview can import it.
 */

export type EnvironmentStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** A single label/value line of connected-Vault info (Vault Name, DNS, ID, Family, …). */
export interface InfoRow {
	label: string;
	value: string;
}

/** One saved environment as the list renders it: identity + non-secret fields + live status. */
export interface EnvironmentRow {
	id: string;
	label: string;
	/** True when the user supplied a custom label; the edit form pre-fills the Label field from this. */
	hasCustomLabel?: boolean;
	vaultDNS: string;
	/** Non-secret; carried so the edit form can prefill without a separate fetch. */
	authType: AuthType;
	username?: string;
	status: EnvironmentStatus;
	isActive: boolean;
	isProduction: boolean;
	/** Present only for the connected environment. */
	info?: InfoRow[];
	/** Present when `status` is "error". */
	error?: string;
}

export interface EnvironmentsSnapshot {
	environments: EnvironmentRow[];
}

/**
 * Whether the active environment is currently connected. The Actions tab gates connection-dependent
 * actions on this, reusing the environments snapshot rather than tracking connection state separately.
 */
export function isActiveEnvironmentConnected(snapshot: EnvironmentsSnapshot): boolean {
	return snapshot.environments.some((env) => env.isActive && env.status === 'connected');
}

/** Non-secret + secret fields submitted from the React add/edit form. */
export interface EnvironmentFormSubmit {
	mode: 'add' | 'edit';
	/** Present for edit; identifies the environment being updated. */
	id?: string;
	vaultDNS: string;
	/**
	 * Optional user-provided display name. When non-empty, stored as a sticky label that is never
	 * overwritten by the auto-adopt-on-connect behaviour. When empty or absent, auto-adopt applies.
	 */
	label?: string;
	username?: string;
	authType: AuthType;
	/** For edit, an empty string means "keep the existing secret". */
	secret: string;
}

/** Environments channel: webview → host. */
export type EnvironmentsToHostMessage =
	| { type: 'ready' }
	| { type: 'connect'; id: string }
	| { type: 'disconnect'; id: string }
	| { type: 'setActive'; id: string }
	| { type: 'remove'; id: string }
	| { type: 'openVault'; id: string }
	| ({ type: 'submitForm' } & EnvironmentFormSubmit);

/** Environments channel: host → webview. */
export type HostToEnvironmentsMessage =
	| { type: 'snapshot'; snapshot: EnvironmentsSnapshot }
	| { type: 'reveal' };
