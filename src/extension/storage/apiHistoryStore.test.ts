import { describe, expect, it } from 'vitest';
import { ApiHistoryStore, MAX_API_HISTORY_ENTRIES } from './apiHistoryStore';
import type { ApiHistoryEntry } from '../../core/rest/apiHistory';

function entry(id: string): ApiHistoryEntry {
	return {
		id,
		timestamp: new Date(0).toISOString(),
		durationMs: 0,
		envId: 'env',
		envLabel: 'Env',
		method: 'GET',
		url: 'https://vault.example/api',
		requestHeaders: {},
		requestBody: null,
		responseStatus: 200,
		responseHeaders: {},
		responseBody: null,
	};
}

describe('ApiHistoryStore', () => {
	it('keeps entries newest-first', () => {
		const store = new ApiHistoryStore();
		store.add(entry('a'));
		store.add(entry('b'));
		expect(store.snapshot().map((e) => e.id)).toEqual(['b', 'a']);
	});

	it('caps at the max, dropping the oldest', () => {
		const store = new ApiHistoryStore();
		for (let i = 0; i < MAX_API_HISTORY_ENTRIES + 5; i += 1) {
			store.add(entry(`e${i}`));
		}
		const snapshot = store.snapshot();
		expect(snapshot).toHaveLength(MAX_API_HISTORY_ENTRIES);
		expect(snapshot[0].id).toBe(`e${MAX_API_HISTORY_ENTRIES + 4}`);
		expect(snapshot.at(-1)?.id).toBe('e5');
	});

	it('clear empties the log', () => {
		const store = new ApiHistoryStore();
		store.add(entry('a'));
		store.clear();
		expect(store.snapshot()).toEqual([]);
	});

	it('fires onDidAdd with each entry and stops after unsubscribe', () => {
		const store = new ApiHistoryStore();
		const seen: string[] = [];
		const unsubscribe = store.onDidAdd((e) => seen.push(e.id));
		store.add(entry('a'));
		unsubscribe();
		store.add(entry('b'));
		expect(seen).toEqual(['a']);
	});

	it('fires onDidClear on clear', () => {
		const store = new ApiHistoryStore();
		let cleared = 0;
		store.onDidClear(() => (cleared += 1));
		store.clear();
		expect(cleared).toBe(1);
	});
});
