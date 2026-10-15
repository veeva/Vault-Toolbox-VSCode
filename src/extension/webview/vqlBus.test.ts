import { describe, it, expect, vi } from 'vitest';
import { VqlBus } from './vqlBus';
import { AuthType, type Environment } from '../../core/models/environment';
import { VaultApiError } from '../../core/rest/errors';
import type { QueryResult } from '../../core/rest/types';
import type { VaultClient } from '../../core/rest/vaultClient';
import type { ConnectionState, RunnableConnection } from '../connection/types';
import type { HostToWebviewMessage } from '../../shared/vqlProtocol';

const RESULT: QueryResult = { data: [{ id: 1 }], responseDetails: { total: 1 }, raw: {} };

const ENV: Environment = {
	id: 'e1',
	label: 'Sandbox',
	vaultDNS: 'myco.veevavault.com',
	authType: AuthType.Basic,
	username: 'admin',
};

function busWith(state: ConnectionState, run?: RunnableConnection['run']) {
	const posted: HostToWebviewMessage[] = [];
	const connection: RunnableConnection = {
		getState: () => state,
		run: run ?? ((fn) => fn({} as VaultClient)),
	};
	return { bus: new VqlBus({ connection, post: (message) => posted.push(message) }), posted };
}

describe('VqlBus message validation', () => {
	it('drops a message with an unknown type', async () => {
		const client = { vql: { query: vi.fn() } } as unknown as VaultClient;
		const { bus, posted } = busWith({ status: 'connected' }, (fn) => fn(client));

		await bus.handle({ type: 'nonsense' });

		expect(client.vql.query).not.toHaveBeenCalled();
		expect(posted).toEqual([]);
	});

	it('drops a runQuery whose vql field is not a string', async () => {
		const client = { vql: { query: vi.fn() } } as unknown as VaultClient;
		const { bus, posted } = busWith({ status: 'connected' }, (fn) => fn(client));

		await bus.handle({ type: 'runQuery', requestId: 'q0', vql: 123 });

		expect(client.vql.query).not.toHaveBeenCalled();
		expect(posted).toEqual([]);
	});

	it('drops a null message', async () => {
		const { bus, posted } = busWith({ status: 'connected' });

		await bus.handle(null);

		expect(posted).toEqual([]);
	});

	it('accepts and handles a valid updateState message', async () => {
		const stateStore = {
			get: vi.fn(),
			set: vi.fn(),
		};
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn({} as VaultClient) },
			post: () => {},
			stateStore,
		});

		const state = { vql: 'SELECT id', viewMode: 'grid' as const };
		await bus.handle({ type: 'updateState', state });

		expect(stateStore.set).toHaveBeenCalledWith(state);
	});

	it('drops an updateState whose state field is not an object', async () => {
		const stateStore = { get: vi.fn(), set: vi.fn() };
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn({} as VaultClient) },
			post: () => {},
			stateStore,
		});

		await bus.handle({ type: 'updateState', state: 'not an object' });
		await bus.handle({ type: 'updateState', state: null });
		await bus.handle({ type: 'updateState' });

		expect(stateStore.set).not.toHaveBeenCalled();
	});
});

describe('VqlBus query routing', () => {
	it('runs a query through connection.run and posts the result with its requestId', async () => {
		const client = { vql: { query: vi.fn().mockResolvedValue(RESULT) } } as unknown as VaultClient;
		const { bus, posted } = busWith({ status: 'connected' }, (fn) => fn(client));

		await bus.handle({ type: 'runQuery', requestId: 'q0', vql: 'SELECT id FROM documents' });

		expect(client.vql.query).toHaveBeenCalledWith('SELECT id FROM documents', 'toolbox-vql-editor');
		expect(posted).toEqual([{ type: 'queryResponse', requestId: 'q0', result: RESULT }]);
	});

	it("routes queryByPage to the client's queryByPage", async () => {
		const client = { vql: { queryByPage: vi.fn().mockResolvedValue(RESULT) } } as unknown as VaultClient;
		const { bus, posted } = busWith({ status: 'connected' }, (fn) => fn(client));

		await bus.handle({ type: 'queryByPage', requestId: 'q1', pageUrl: '/api/v26.1/query/tok?x' });

		expect(client.vql.queryByPage).toHaveBeenCalledWith(
			'/api/v26.1/query/tok?x',
			'toolbox-vql-editor',
		);
		expect(posted[0]).toMatchObject({ type: 'queryResponse', requestId: 'q1' });
	});

	it('normalizes a VaultApiError into a queryError with its type', async () => {
		const { bus, posted } = busWith({ status: 'connected' }, () =>
			Promise.reject(new VaultApiError('bad vql', 'MALFORMED_QUERY')),
		);

		await bus.handle({ type: 'runQuery', requestId: 'q2', vql: 'SELCT' });

		expect(posted).toEqual([
			{
				type: 'queryError',
				requestId: 'q2',
				error: { type: 'MALFORMED_QUERY', message: 'bad vql' },
			},
		]);
	});

	it('includes the raw response body when the VaultApiError carries one', async () => {
		const failureBody = { responseStatus: 'FAILURE', errors: [{ type: 'MALFORMED_QUERY', message: 'bad vql' }] };
		const { bus, posted } = busWith({ status: 'connected' }, () =>
			Promise.reject(new VaultApiError('bad vql', 'MALFORMED_QUERY', failureBody)),
		);

		await bus.handle({ type: 'runQuery', requestId: 'q2b', vql: 'SELCT' });

		expect(posted).toEqual([
			{
				type: 'queryError',
				requestId: 'q2b',
				error: { type: 'MALFORMED_QUERY', message: 'bad vql', response: failureBody },
			},
		]);
	});

	it('normalizes a plain Error (e.g. not connected) using its name', async () => {
		const { bus, posted } = busWith({ status: 'disconnected' }, () =>
			Promise.reject(new Error('Not connected to a Vault.')),
		);

		await bus.handle({ type: 'runQuery', requestId: 'q3', vql: 'SELECT id FROM documents' });

		expect(posted[0]).toEqual({
			type: 'queryError',
			requestId: 'q3',
			error: { type: 'Error', message: 'Not connected to a Vault.' },
		});
	});
});

describe('VqlBus CSV export', () => {
	function pageResult(rows: number, nextPage?: string): QueryResult {
		return {
			data: Array.from({ length: rows }, (_, i) => ({ id: i, name__v: `n${i}` })),
			responseDetails: { total: rows, nextPage },
			raw: {},
		};
	}

	it('follows next_page across pages, serializes to CSV, and reports the saved path + row count', async () => {
		const client = {
			vql: {
				query: vi.fn().mockResolvedValue(pageResult(2, '/api/v26.1/query/tok?pageoffset=2')),
				queryByPage: vi.fn().mockResolvedValue(pageResult(1)),
			},
		} as unknown as VaultClient;
		const exportSink = vi.fn().mockResolvedValue('/tmp/query_results.csv');
		const posted: HostToWebviewMessage[] = [];
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn(client) },
			post: (message) => posted.push(message),
			exportSink,
		});

		await bus.handle({
			type: 'exportCsv',
			requestId: 'x0',
			vql: 'SELECT id, name__v FROM documents',
			pagination: { total: 3, pagesize: 1000 },
		});

		expect(client.vql.queryByPage).toHaveBeenCalledWith(
			'/api/v26.1/query/tok?pageoffset=2',
			'toolbox-vql-editor',
		);
		const csv = exportSink.mock.calls[0][0] as string;
		expect(csv.split('\r\n')).toHaveLength(4); // header + 3 rows
		expect(csv.startsWith('"id","name__v"')).toBe(true);
		expect(exportSink.mock.calls[0][2]).toEqual({ rowCount: 3 });
		expect(posted).toEqual([
			{
				type: 'exportResult',
				requestId: 'x0',
				savedPath: '/tmp/query_results.csv',
				rowCount: 3,
			},
		]);
	});

	it('exports all rows following pagination to exhaustion', async () => {
		const client = {
			vql: {
				query: vi.fn().mockResolvedValue(pageResult(1000, '/api/v26.1/query/tok?pageoffset=1000')),
				queryByPage: vi
					.fn()
					.mockResolvedValueOnce(pageResult(1000, '/api/v26.1/query/tok?pageoffset=2000'))
					.mockResolvedValueOnce(pageResult(500)),
			},
		} as unknown as VaultClient;
		const exportSink = vi.fn().mockResolvedValue('/tmp/q.csv');
		const posted: HostToWebviewMessage[] = [];
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn(client) },
			post: (message) => posted.push(message),
			exportSink,
		});

		await bus.handle({ type: 'exportCsv', requestId: 'x1', vql: 'SELECT id FROM documents', pagination: { total: 2500, pagesize: 1000 } });

		expect((exportSink.mock.calls[0][0] as string).split('\r\n')).toHaveLength(2501); // header + 2500 rows
		expect(exportSink.mock.calls[0][2]).toEqual({ rowCount: 2500 });
		expect(posted[0]).toMatchObject({
			type: 'exportResult',
			requestId: 'x1',
			rowCount: 2500,
		});
	});

	it("expands subquery rows, following each subquery's own next_page chain, into the CSV", async () => {
		const describe = {
			subqueries: [
				{ relationship: 'child_object__cr', fields: [{ name: 'id' }, { name: 'name__v' }] },
			],
		};
		const firstPage: QueryResult = {
			data: [
				{
					id: 1,
					child_object__cr: {
						data: [{ id: 10, name__v: 'X' }],
						responseDetails: { total: 2, next_page: '/api/v26.1/query/sub-tok?pageoffset=1' },
					},
				},
			],
			responseDetails: { total: 1 },
			queryDescribe: describe,
			raw: {},
		};
		const subPage: QueryResult = { data: [{ id: 11, name__v: 'Y' }], responseDetails: {}, raw: {} };
		const client = {
			vql: {
				query: vi.fn().mockResolvedValue(firstPage),
				queryByPage: vi.fn().mockResolvedValue(subPage),
			},
		} as unknown as VaultClient;
		const exportSink = vi.fn().mockResolvedValue('/tmp/query_results.csv');
		const posted: HostToWebviewMessage[] = [];
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn(client) },
			post: (message) => posted.push(message),
			exportSink,
		});

		await bus.handle({
			type: 'exportCsv',
			requestId: 'x3',
			vql: 'SELECT id, (SELECT id, name__v FROM child_object__cr) FROM documents',
			pagination: { total: 1, pagesize: 1000 },
		});

		expect(client.vql.queryByPage).toHaveBeenCalledWith(
			'/api/v26.1/query/sub-tok?pageoffset=1',
			'toolbox-vql-editor',
		);
		const csv = exportSink.mock.calls[0][0] as string;
		expect(csv).toBe(
			'"id","child_object__cr.id","child_object__cr.name__v"\r\n' +
				'"1","10","X"\r\n' +
				'"1","11","Y"',
		);
		expect(posted[0]).toMatchObject({
			type: 'exportResult',
			requestId: 'x3',
			rowCount: 1,
		});
	});

	it('reports a cancelled save (no savedPath, no error)', async () => {
		const client = { vql: { query: vi.fn().mockResolvedValue(pageResult(1)) } } as unknown as VaultClient;
		const posted: HostToWebviewMessage[] = [];
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn(client) },
			post: (message) => posted.push(message),
			exportSink: () => Promise.resolve(undefined),
		});

		await bus.handle({ type: 'exportCsv', requestId: 'x2', vql: 'SELECT id FROM documents', pagination: { total: 1, pagesize: 1000 } });

		expect(posted[0]).toEqual({
			type: 'exportResult',
			requestId: 'x2',
			savedPath: undefined,
			rowCount: 1,
		});
	});

	it('shows confirmation modal for exports >= 10k rows and proceeds when confirmed', async () => {
		const client = { vql: { query: vi.fn().mockResolvedValue(pageResult(10)) } } as unknown as VaultClient;
		const exportSink = vi.fn().mockResolvedValue('/tmp/large.csv');
		const confirmLargeExport = vi.fn().mockResolvedValue(true);
		const posted: HostToWebviewMessage[] = [];
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn(client) },
			post: (message) => posted.push(message),
			exportSink,
			confirmLargeExport,
		});

		await bus.handle({ type: 'exportCsv', requestId: 'x4', vql: 'SELECT id FROM documents', pagination: { total: 10000, pagesize: 1000 } });

		expect(confirmLargeExport).toHaveBeenCalledWith(10000, 10);
		expect(exportSink).toHaveBeenCalled();
		expect(posted[0]).toMatchObject({
			type: 'exportResult',
			requestId: 'x4',
			savedPath: '/tmp/large.csv',
		});
	});

	it('posts empty result when user cancels the large export confirmation modal', async () => {
		const client = { vql: { query: vi.fn() } } as unknown as VaultClient;
		const exportSink = vi.fn();
		const confirmLargeExport = vi.fn().mockResolvedValue(false);
		const posted: HostToWebviewMessage[] = [];
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn(client) },
			post: (message) => posted.push(message),
			exportSink,
			confirmLargeExport,
		});

		await bus.handle({ type: 'exportCsv', requestId: 'x5', vql: 'SELECT id FROM documents', pagination: { total: 50000, pagesize: 1000 } });

		expect(confirmLargeExport).toHaveBeenCalledWith(50000, 50);
		expect(client.vql.query).not.toHaveBeenCalled();
		expect(exportSink).not.toHaveBeenCalled();
		expect(posted).toEqual([{ type: 'exportResult', requestId: 'x5' }]);
	});

	it('bypasses confirmation modal for exports < 10k rows', async () => {
		const client = { vql: { query: vi.fn().mockResolvedValue(pageResult(5)) } } as unknown as VaultClient;
		const exportSink = vi.fn().mockResolvedValue('/tmp/small.csv');
		const confirmLargeExport = vi.fn();
		const posted: HostToWebviewMessage[] = [];
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn(client) },
			post: (message) => posted.push(message),
			exportSink,
			confirmLargeExport,
		});

		await bus.handle({ type: 'exportCsv', requestId: 'x6', vql: 'SELECT id FROM documents', pagination: { total: 9999, pagesize: 1000 } });

		expect(confirmLargeExport).not.toHaveBeenCalled();
		expect(exportSink).toHaveBeenCalled();
		expect(posted[0]).toMatchObject({
			type: 'exportResult',
			requestId: 'x6',
			savedPath: '/tmp/small.csv',
		});
	});
});

describe('VqlBus query history', () => {
	function historyPort(initial: string[] = []) {
		let entries = [...initial];
		return {
			list: () => entries,
			add: vi.fn(async (vql: string) => {
				entries = [vql, ...entries.filter((entry) => entry !== vql)];
				return entries;
			}),
			clear: vi.fn(async () => {
				entries = [];
			}),
		};
	}

	it('on ready, pushes the current history alongside the connection state', () => {
		const posted: HostToWebviewMessage[] = [];
		const history = historyPort(['SELECT id FROM documents']);
		const bus = new VqlBus({
			connection: {
				getState: () => ({ status: 'disconnected' }),
				run: (fn) => fn({} as VaultClient),
			},
			post: (message) => posted.push(message),
			history,
		});

		bus.handle({ type: 'ready' });

		expect(posted).toContainEqual({ type: 'history', entries: ['SELECT id FROM documents'] });
	});

	it('logs a successful run to history and pushes the updated list', async () => {
		const client = { vql: { query: vi.fn().mockResolvedValue(RESULT) } } as unknown as VaultClient;
		const posted: HostToWebviewMessage[] = [];
		const history = historyPort();
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn(client) },
			post: (message) => posted.push(message),
			history,
		});

		await bus.handle({ type: 'runQuery', requestId: 'q0', vql: 'SELECT id FROM documents' });

		expect(history.add).toHaveBeenCalledWith('SELECT id FROM documents');
		expect(posted).toContainEqual({ type: 'history', entries: ['SELECT id FROM documents'] });
	});

	it('does not log a failed run', async () => {
		const posted: HostToWebviewMessage[] = [];
		const history = historyPort();
		const bus = new VqlBus({
			connection: {
				getState: () => ({ status: 'connected' }),
				run: () => Promise.reject(new VaultApiError('bad', 'MALFORMED_QUERY')),
			},
			post: (message) => posted.push(message),
			history,
		});

		await bus.handle({ type: 'runQuery', requestId: 'q1', vql: 'SELCT' });

		expect(history.add).not.toHaveBeenCalled();
		expect(posted.some((message) => message.type === 'history')).toBe(false);
	});

	it('clears history on request and pushes the empty list', async () => {
		const posted: HostToWebviewMessage[] = [];
		const history = historyPort(['SELECT id FROM documents']);
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn({} as VaultClient) },
			post: (message) => posted.push(message),
			history,
		});

		await bus.handle({ type: 'clearHistory' });

		expect(history.clear).toHaveBeenCalled();
		expect(posted).toContainEqual({ type: 'history', entries: [] });
	});
});

describe('VqlBus saved queries', () => {
	function savedPort(initial: { name: string; vql: string }[] = []) {
		let entries = [...initial];
		return {
			list: () => entries,
			add: vi.fn(async (name: string, vql: string) => {
				entries = [{ name, vql }, ...entries.filter((entry) => entry.name !== name)];
				return entries;
			}),
			remove: vi.fn(async (name: string) => {
				entries = entries.filter((entry) => entry.name !== name);
				return entries;
			}),
		};
	}

	it('on ready, pushes the current saved queries', () => {
		const posted: HostToWebviewMessage[] = [];
		const savedQueries = savedPort([{ name: 'docs', vql: 'SELECT id FROM documents' }]);
		const bus = new VqlBus({
			connection: {
				getState: () => ({ status: 'disconnected' }),
				run: (fn) => fn({} as VaultClient),
			},
			post: (message) => posted.push(message),
			savedQueries,
		});

		bus.handle({ type: 'ready' });

		expect(posted).toContainEqual({
			type: 'savedQueries',
			entries: [{ name: 'docs', vql: 'SELECT id FROM documents' }],
		});
	});

	it('prompts for a name, saves, and pushes the updated list', async () => {
		const posted: HostToWebviewMessage[] = [];
		const savedQueries = savedPort();
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn({} as VaultClient) },
			post: (message) => posted.push(message),
			savedQueries,
			promptSaveName: () => Promise.resolve('docs'),
		});

		await bus.handle({ type: 'saveQuery', vql: 'SELECT id FROM documents' });

		expect(savedQueries.add).toHaveBeenCalledWith('docs', 'SELECT id FROM documents');
		expect(posted).toContainEqual({
			type: 'savedQueries',
			entries: [{ name: 'docs', vql: 'SELECT id FROM documents' }],
		});
	});

	it('does not save when the name prompt is cancelled', async () => {
		const posted: HostToWebviewMessage[] = [];
		const savedQueries = savedPort();
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn({} as VaultClient) },
			post: (message) => posted.push(message),
			savedQueries,
			promptSaveName: () => Promise.resolve(undefined),
		});

		await bus.handle({ type: 'saveQuery', vql: 'SELECT id FROM documents' });

		expect(savedQueries.add).not.toHaveBeenCalled();
		expect(posted.some((message) => message.type === 'savedQueries')).toBe(false);
	});

	it('deletes a saved query by name and pushes the updated list', async () => {
		const posted: HostToWebviewMessage[] = [];
		const savedQueries = savedPort([
			{ name: 'docs', vql: 'SELECT id FROM documents' },
			{ name: 'users', vql: 'SELECT id FROM users' },
		]);
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn({} as VaultClient) },
			post: (message) => posted.push(message),
			savedQueries,
		});

		await bus.handle({ type: 'deleteSavedQuery', name: 'docs' });

		expect(savedQueries.remove).toHaveBeenCalledWith('docs');
		expect(posted).toContainEqual({
			type: 'savedQueries',
			entries: [{ name: 'users', vql: 'SELECT id FROM users' }],
		});
	});
});

describe('VqlBus clipboard', () => {
	it('reads the OS clipboard via the dep and posts the response with its requestId', async () => {
		const posted: HostToWebviewMessage[] = [];
		const bus = new VqlBus({
			connection: { getState: () => ({ status: 'connected' }), run: (fn) => fn({} as VaultClient) },
			post: (message) => posted.push(message),
			clipboard: () => Promise.resolve('SELECT id FROM documents'),
		});

		await bus.handle({ type: 'clipboardReadRequest', requestId: 'c0' });

		expect(posted).toEqual([
			{ type: 'clipboardReadResponse', requestId: 'c0', text: 'SELECT id FROM documents' },
		]);
	});

	it('responds with empty text when no clipboard dep is provided', async () => {
		const { bus, posted } = busWith({ status: 'connected' });

		await bus.handle({ type: 'clipboardReadRequest', requestId: 'c1' });

		expect(posted).toEqual([{ type: 'clipboardReadResponse', requestId: 'c1', text: '' }]);
	});
});


describe('VqlBus connection snapshot', () => {
	it('on ready, pushes a disconnected snapshot and restoreState', () => {
		const { bus, posted } = busWith({ status: 'disconnected' });

		bus.handle({ type: 'ready' });

		expect(posted).toEqual([
			{
				type: 'connectionState',
				state: {
					status: 'disconnected',
					isProduction: false,
					vaultDns: undefined,
					label: undefined,
				},
			},
			{
				type: 'restoreState',
				state: undefined,
			},
		]);
	});

	it('flags a connected Production Vault with its DNS + label', () => {
		const state: ConnectionState = {
			status: 'connected',
			envId: ENV.id,
			info: {
				environment: ENV,
				apiVersion: 'v26.1',
				domain: { domainType: 'PRODUCTION', vaults: [] },
			},
		};
		const { bus, posted } = busWith(state);

		bus.pushConnectionState();

		expect(posted[0]).toEqual({
			type: 'connectionState',
			state: {
				status: 'connected',
				vaultDns: 'myco.veevavault.com',
				label: 'Sandbox',
				isProduction: true,
			},
		});
	});
});
