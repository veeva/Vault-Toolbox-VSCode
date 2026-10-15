import { addSavedQuery, removeSavedQuery, type SavedQuery } from '../../core/vql/savedQueries';
import { KeyedListStore } from './keyedStore';
import type { KeyValueStore } from './types';

const KEY = 'vaultToolbox.vqlSavedQueries';

/**
 * Persists the VQL Editor's named saved queries in `globalState` (application-wide, matching the
 * history store). Ordering/dedup logic lives in the vscode-free `savedQueries` helpers.
 */
export class SavedQueryStore {
	private readonly store: KeyedListStore<SavedQuery>;

	constructor(store: KeyValueStore) {
		this.store = new KeyedListStore(store, KEY);
	}

	list(): SavedQuery[] {
		return this.store.list();
	}

	/** Save `vql` under `name` (replacing any same-named entry, moved to front) and persist. */
	add(name: string, vql: string): Promise<SavedQuery[]> {
		return this.store.mutate((queries) => addSavedQuery(queries, name, vql));
	}

	/** Remove the entry named `name` and persist. Returns the updated list. */
	remove(name: string): Promise<SavedQuery[]> {
		return this.store.mutate((queries) => removeSavedQuery(queries, name));
	}
}
