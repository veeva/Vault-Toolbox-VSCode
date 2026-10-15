import { KeyedValueStore } from './keyedStore';
import type { KeyValueStore } from './types';

const KEY = 'vaultToolbox.activeEnvironmentId';

/**
 * Tracks which Environment is active in the current workspace. Backed by `workspaceState`
 * so each workspace remembers its own target Vault (see ADR 0003).
 */
export class ActiveEnvironmentStore {
	private readonly store: KeyedValueStore<string>;

	constructor(store: KeyValueStore) {
		this.store = new KeyedValueStore(store, KEY);
	}

	get(): string | undefined {
		return this.store.get();
	}

	set(id: string | undefined): Promise<void> {
		return this.store.set(id);
	}

	clear(): Promise<void> {
		return this.store.set(undefined);
	}
}
