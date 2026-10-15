import type { KeyValueStore } from './types';

/**
 * The persistence pattern shared by every keyed slice of a {@link KeyValueStore}: read the value
 * under one key (defaulting a list to `[]`), apply a pure transform, and write it back. Concentrated
 * here so the domain stores (environments, history, saved queries, active env) carry only their key
 * and their pure helper — the `get ?? default → mutate → update` dance lives in one place.
 */

/** A single value persisted under one key. Reads return `undefined` until first set. */
export class KeyedValueStore<T> {
	constructor(
		private readonly store: KeyValueStore,
		private readonly key: string,
	) {}

	get(): T | undefined {
		return this.store.get<T>(this.key);
	}

	/** Persist `value`; passing `undefined` clears the key. */
	set(value: T | undefined): Promise<void> {
		return Promise.resolve(this.store.update(this.key, value));
	}
}

/** A list persisted under one key. Reads default to `[]`; mutations go through a pure transform. */
export class KeyedListStore<T> {
	constructor(
		private readonly store: KeyValueStore,
		private readonly key: string,
	) {}

	list(): T[] {
		// Guard the shape, not just null/undefined: a corrupt or schema-drifted persisted value
		// (e.g. an object left by an older version) would otherwise crash downstream .find/.filter.
		const stored = this.store.get<T[]>(this.key);
		return Array.isArray(stored) ? stored : [];
	}

	/** Apply a pure transform to the current list, persist the result, and return it. */
	async mutate(fn: (current: T[]) => T[]): Promise<T[]> {
		const next = fn(this.list());
		await this.store.update(this.key, next);
		return next;
	}

	/** Overwrite the whole list. */
	set(value: T[]): Promise<void> {
		return Promise.resolve(this.store.update(this.key, value));
	}
}
