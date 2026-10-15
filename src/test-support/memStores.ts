import type { KeyValueStore, SecretStore } from '../extension/storage/types';

/** In-memory KeyValueStore standing in for a vscode.Memento in tests. */
export class MemKeyValueStore implements KeyValueStore {
	readonly map = new Map<string, unknown>();

	get<T>(key: string): T | undefined {
		return this.map.get(key) as T | undefined;
	}

	update(key: string, value: unknown): PromiseLike<void> {
		if (value === undefined) {
			this.map.delete(key);
		} else {
			this.map.set(key, value);
		}
		return Promise.resolve();
	}
}

/** In-memory SecretStore standing in for a vscode.SecretStorage in tests. */
export class MemSecretStore implements SecretStore {
	readonly map = new Map<string, string>();

	get(key: string): PromiseLike<string | undefined> {
		return Promise.resolve(this.map.get(key));
	}

	store(key: string, value: string): PromiseLike<void> {
		this.map.set(key, value);
		return Promise.resolve();
	}

	delete(key: string): PromiseLike<void> {
		this.map.delete(key);
		return Promise.resolve();
	}
}
