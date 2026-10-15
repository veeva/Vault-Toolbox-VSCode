import { describe, expect, it } from 'vitest';
import {
	RecordingHttpTransport,
	ReplayHttpTransport,
	serializeCassetteBody,
	type CassetteEntry,
	type CassetteSink,
} from './replayHttpTransport';
import type { HttpRequest, HttpTransport, VaultHttpResponse } from './types';

const AUTH_ENTRY: CassetteEntry = {
	request: { method: 'POST', url: 'https://myco.veevavault.com/api/v26.1/auth', body: 'username=u' },
	response: {
		status: 200,
		headers: { 'x-vaultapi-status': 'SUCCESS' },
		body: { responseStatus: 'SUCCESS', sessionId: 'SESS' },
	},
};

const QUERY_URL = 'https://myco.veevavault.com/api/v26.1/query';

function pageEntry(page: number, nextPage: string | undefined): CassetteEntry {
	return {
		request: { method: 'POST', url: QUERY_URL, body: 'q=SELECT+id+FROM+documents' },
		response: {
			status: 200,
			headers: {},
			body: { responseStatus: 'SUCCESS', data: [{ id: page }], responseDetails: { next_page: nextPage } },
		},
	};
}

describe('serializeCassetteBody', () => {
	it('renders URLSearchParams to their query string and leaves strings untouched', () => {
		expect(serializeCassetteBody(new URLSearchParams({ q: 'a b' }))).toBe('q=a+b');
		expect(serializeCassetteBody('raw')).toBe('raw');
	});

	it('returns undefined for a bodiless request', () => {
		expect(serializeCassetteBody(undefined)).toBeUndefined();
	});
});

describe('ReplayHttpTransport', () => {
	it('returns the recorded response for a matching request with a case-insensitive getHeader', async () => {
		const transport = new ReplayHttpTransport([AUTH_ENTRY]);

		const response = await transport.send({
			method: 'POST',
			url: 'https://myco.veevavault.com/api/v26.1/auth',
			body: new URLSearchParams({ username: 'u' }),
		});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ responseStatus: 'SUCCESS', sessionId: 'SESS' });
		expect(response.getHeader('X-VaultAPI-Status')).toBe('SUCCESS');
	});

	it('consumes repeated identical requests in recorded order so pagination replays page-by-page', async () => {
		const transport = new ReplayHttpTransport([
			pageEntry(1, '/api/v26.1/query/page2'),
			pageEntry(2, undefined),
		]);
		const query: HttpRequest = {
			method: 'POST',
			url: QUERY_URL,
			body: new URLSearchParams({ q: 'SELECT id FROM documents' }),
		};

		const first = await transport.send(query);
		const second = await transport.send(query);

		expect((first.body as { data: unknown }).data).toEqual([{ id: 1 }]);
		expect((second.body as { data: unknown }).data).toEqual([{ id: 2 }]);
	});

	it('throws a descriptive error when no entry matches', async () => {
		const transport = new ReplayHttpTransport([AUTH_ENTRY]);

		await expect(
			transport.send({ method: 'GET', url: 'https://myco.veevavault.com/api/' }),
		).rejects.toThrow(/No cassette entry matches GET/);
	});

	it('rebuilds a Uint8Array from a recorded binary body so /code source replays as bytes', async () => {
		const source = 'package com.veeva.vault.custom;\npublic class X {}\n';
		const codeEntry: CassetteEntry = {
			request: { method: 'GET', url: 'https://myco.veevavault.com/api/v26.1/code/com.veeva.vault.custom.X' },
			response: { status: 200, headers: {}, body: { __cassetteBinaryUtf8__: source } },
		};
		const transport = new ReplayHttpTransport([codeEntry]);

		const response = await transport.send({
			method: 'GET',
			url: 'https://myco.veevavault.com/api/v26.1/code/com.veeva.vault.custom.X',
		});

		expect(response.body).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(response.body as Uint8Array)).toBe(source);
	});
});

class StubTransport implements HttpTransport {
	constructor(private readonly response: VaultHttpResponse) {}
	send(): Promise<VaultHttpResponse> {
		return Promise.resolve(this.response);
	}
}

class ArraySink implements CassetteSink {
	readonly entries: CassetteEntry[] = [];
	add(entry: CassetteEntry): void {
		this.entries.push(entry);
	}
}

describe('RecordingHttpTransport', () => {
	it('captures the exchange to the sink and passes the real response through unchanged', async () => {
		const response: VaultHttpResponse = {
			status: 200,
			headers: { 'x-vaultapi-status': 'SUCCESS' },
			getHeader: () => 'SUCCESS',
			body: { responseStatus: 'SUCCESS' },
		};
		const sink = new ArraySink();
		const transport = new RecordingHttpTransport(new StubTransport(response), sink);

		const returned = await transport.send({
			method: 'POST',
			url: QUERY_URL,
			body: new URLSearchParams({ q: 'SELECT id FROM documents' }),
		});

		expect(returned).toBe(response);
		expect(sink.entries).toEqual([
			{
				request: { method: 'POST', url: QUERY_URL, body: 'q=SELECT+id+FROM+documents' },
				response: {
					status: 200,
					headers: { 'x-vaultapi-status': 'SUCCESS' },
					body: { responseStatus: 'SUCCESS' },
				},
			},
		]);
	});

	it('records a binary body as readable UTF-8 text so the cassette stays hand-editable', async () => {
		const source = 'package com.veeva.vault.custom;\npublic class X {}\n';
		const response: VaultHttpResponse = {
			status: 200,
			headers: {},
			getHeader: () => undefined,
			body: new TextEncoder().encode(source),
		};
		const sink = new ArraySink();
		const transport = new RecordingHttpTransport(new StubTransport(response), sink);

		await transport.send({
			method: 'GET',
			url: 'https://myco.veevavault.com/api/v26.1/code/com.veeva.vault.custom.X',
		});

		expect(sink.entries[0].response.body).toEqual({ __cassetteBinaryUtf8__: source });
	});
});
