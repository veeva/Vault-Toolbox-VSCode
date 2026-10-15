import { addToHistory } from '../../core/vql/queryHistory';
import { KeyedListStore } from './keyedStore';
import type { KeyValueStore } from './types';

const KEY = 'vaultToolbox.vqlHistory';

/**
 * Persists the VQL Editor query history in `globalState` (application-wide). Ordering/dedup/cap logic lives in the vscode-free `addToHistory`.
 */
export class QueryHistoryStore {
	private readonly store: KeyedListStore<string>;

	constructor(store: KeyValueStore) {
		this.store = new KeyedListStore(store, KEY);
	}

	list(): string[] {
		return this.store.list();
	}

	/** Promote `vql` to the front (dedup, capped) and persist. Returns the updated list. */
	add(vql: string): Promise<string[]> {
		return this.store.mutate((history) => addToHistory(history, vql));
	}

	clear(): Promise<void> {
		return this.store.set([]);
	}
}
