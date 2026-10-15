import type { Environment } from '../../core/models/environment';
import { KeyedListStore } from './keyedStore';
import type { KeyValueStore } from './types';

const KEY = 'vaultToolbox.environments';

/**
 * Persists the global list of Environments (non-secret fields only) in `globalState`.
 * Secrets are held separately by CredentialStore.
 */
export class EnvironmentStore {
	private readonly store: KeyedListStore<Environment>;

	constructor(store: KeyValueStore) {
		this.store = new KeyedListStore(store, KEY);
	}

	list(): Environment[] {
		return this.store.list();
	}

	get(id: string): Environment | undefined {
		return this.list().find((env) => env.id === id);
	}

	/** Insert a new Environment or replace the existing one with the same id. */
	async upsert(env: Environment): Promise<void> {
		await this.store.mutate((envs) => {
			const index = envs.findIndex((existing) => existing.id === env.id);
			if (index < 0) {
				return [...envs, env];
			}
			const next = [...envs];
			next[index] = env;
			return next;
		});
	}

	async remove(id: string): Promise<void> {
		await this.store.mutate((envs) => envs.filter((env) => env.id !== id));
	}
}
