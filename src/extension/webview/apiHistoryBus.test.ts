import { describe, expect, it, vi } from 'vitest';
import { ApiHistoryBus, type ApiHistorySource } from './apiHistoryBus';
import type { HostToApiHistoryMessage } from '../../shared/apiHistoryProtocol';
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

function setup(snapshot: ApiHistoryEntry[] = [], onReady?: () => void) {
	const posted: HostToApiHistoryMessage[] = [];
	let cleared = 0;
	const store: ApiHistorySource = {
		snapshot: () => snapshot,
		clear: () => {
			cleared += 1;
		},
	};
	const bus = new ApiHistoryBus({ store, post: (message) => posted.push(message), onReady });
	return { bus, posted, clearCount: () => cleared };
}

describe('ApiHistoryBus', () => {
	it('posts the current snapshot on ready', () => {
		const { bus, posted } = setup([entry('a')]);
		bus.handle({ type: 'ready' });
		expect(posted).toEqual([{ type: 'snapshot', entries: [entry('a')] }]);
	});

	it('clears the store on clear', () => {
		const { bus, clearCount } = setup();
		bus.handle({ type: 'clear' });
		expect(clearCount()).toBe(1);
	});

	it('drops malformed messages', () => {
		const { bus, posted, clearCount } = setup();
		bus.handle(null);
		bus.handle({ type: 'bogus' });
		bus.handle('ready');
		expect(posted).toEqual([]);
		expect(clearCount()).toBe(0);
	});

	it('pushes entry and cleared messages', () => {
		const { bus, posted } = setup();
		bus.pushEntry(entry('x'));
		bus.pushCleared();
		expect(posted).toEqual([{ type: 'entry', entry: entry('x') }, { type: 'cleared' }]);
	});

	it('posts a reveal immediately once the webview is ready', () => {
		const { bus, posted } = setup();
		bus.handle({ type: 'ready' });
		posted.length = 0;

		bus.pushReveal('target');

		expect(posted).toEqual([{ type: 'reveal', id: 'target' }]);
	});

	it('posts a reveal immediately regardless of ready state', () => {
		const { bus, posted } = setup([entry('a')]);

		bus.pushReveal('target');

		expect(posted).toEqual([{ type: 'reveal', id: 'target' }]);
	});

	it('calls onReady when the ready message is received', () => {
		const onReady = vi.fn();
		const { bus } = setup([], onReady);

		bus.handle({ type: 'ready' });

		expect(onReady).toHaveBeenCalledOnce();
	});
});
