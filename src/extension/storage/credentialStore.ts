import type { SecretStore } from './types';

/**
 * Stores the one secret per Environment — the password (Basic auth) or the session ID
 * (Session-ID auth) — in SecretStorage, namespaced by Environment id. Nothing secret is
 * ever written to globalState.
 */
export class CredentialStore {
	constructor(private readonly secrets: SecretStore) {}

	private key(envId: string): string {
		return `vaultToolbox.env.${envId}.secret`;
	}

	get(envId: string): PromiseLike<string | undefined> {
		return this.secrets.get(this.key(envId));
	}

	set(envId: string, secret: string): PromiseLike<void> {
		return this.secrets.store(this.key(envId), secret);
	}

	delete(envId: string): PromiseLike<void> {
		return this.secrets.delete(this.key(envId));
	}
}
