/**
 * Minimal structural interfaces over the VSCode storage primitives, so the stores can be
 * unit-tested with in-memory fakes and never import "vscode" directly.
 *
 * `vscode.Memento` satisfies KeyValueStore; `vscode.SecretStorage` satisfies SecretStore.
 */

export interface KeyValueStore {
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): PromiseLike<void>;
}

export interface SecretStore {
	get(key: string): PromiseLike<string | undefined>;
	store(key: string, value: string): PromiseLike<void>;
	delete(key: string): PromiseLike<void>;
}
