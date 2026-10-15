import { describe, expect, it } from 'vitest';
import { LoggingHttpTransport, type ApiHistorySink } from './loggingHttpTransport';
import { VaultApiError } from './errors';
import type { ApiHistoryEntry } from './apiHistory';
import type { HttpRequest, HttpTransport, VaultHttpResponse } from './types';

class RecordingSink implements ApiHistorySink {
	readonly entries: ApiHistoryEntry[] = [];
	add(entry: ApiHistoryEntry): void {
		this.entries.push(entry);
	}
}

function okResponse(overrides: Partial<VaultHttpResponse> = {}): VaultHttpResponse {
	return {
		status: 200,
		headers: { 'x-vaultapi-status': 'SUCCESS' },
		getHeader: () => undefined,
		body: { responseStatus: 'SUCCESS', data: [{ id: 1 }] },
		...overrides,
	};
}

class StubTransport implements HttpTransport {
	constructor(private readonly outcome: () => Promise<VaultHttpResponse>) {}
	send(): Promise<VaultHttpResponse> {
		return this.outcome();
	}
}

const REQUEST: HttpRequest = {
	url: 'https://myco.veevavault.com/api/v26.1/query',
	method: 'POST',
	headers: { authorization: 'secret-session', 'X-VaultAPI-ClientID': 'toolbox' },
	body: new URLSearchParams({ q: 'SELECT id FROM documents' }),
};

function makeContext(sink: ApiHistorySink) {
	let clock = 1000;
	return {
		envId: 'env-1',
		envLabel: 'Sandbox',
		sink,
		now: () => (clock += 250),
		makeId: () => 'fixed-id',
	};
}

describe('LoggingHttpTransport', () => {
	it('records a success entry with timing, redacted headers, and env, and returns the response', async () => {
		const sink = new RecordingSink();
		const response = okResponse();
		const transport = new LoggingHttpTransport(
			new StubTransport(() => Promise.resolve(response)),
			makeContext(sink),
		);

		const returned = await transport.send(REQUEST, 15000);

		expect(returned).toBe(response);
		expect(sink.entries).toHaveLength(1);
		const entry = sink.entries[0];
		expect(entry.envId).toBe('env-1');
		expect(entry.envLabel).toBe('Sandbox');
		expect(entry.method).toBe('POST');
		expect(entry.responseStatus).toBe(200);
		expect(entry.responseHeaders).toEqual({ 'x-vaultapi-status': 'SUCCESS' });
		expect(entry.requestHeaders).toEqual({ 'X-VaultAPI-ClientID': 'toolbox' });
		expect(entry.requestBody).toBe('q=SELECT+id+FROM+documents');
		expect(entry.timestamp).toBe(new Date(1250).toISOString());
		expect(entry.durationMs).toBe(250);
		expect(entry.error).toBeUndefined();
	});

	it('records a null-status error entry and re-throws on transport failure', async () => {
		const sink = new RecordingSink();
		const failure = new VaultApiError('Request timed out after 15000ms', 'TIMEOUT');
		const transport = new LoggingHttpTransport(
			new StubTransport(() => Promise.reject(failure)),
			makeContext(sink),
		);

		await expect(transport.send(REQUEST, 15000)).rejects.toBe(failure);

		expect(sink.entries).toHaveLength(1);
		const entry = sink.entries[0];
		expect(entry.responseStatus).toBeNull();
		expect(entry.responseBody).toBeNull();
		expect(entry.error).toEqual({ type: 'TIMEOUT', message: 'Request timed out after 15000ms' });
	});
});
