import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeHttpTransport } from './nodeHttpTransport';
import { VaultApiError } from './errors';
import type { HttpRequest } from './types';

const REQUEST: HttpRequest = { url: 'https://vault.example/api', method: 'GET', headers: {} };

function fakeResponse(status: number, text: string, headers: Record<string, string> = {}) {
	return {
		status,
		headers: new Headers(headers),
		text: () => Promise.resolve(text),
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('NodeHttpTransport', () => {
	it('parses a JSON body and exposes response headers', async () => {
		vi.stubGlobal('fetch', () =>
			Promise.resolve(
				fakeResponse(200, '{"responseStatus":"SUCCESS"}', { 'x-vaultapi-vaultid': '42' }),
			),
		);

		const response = await new NodeHttpTransport().send(REQUEST, 1000);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ responseStatus: 'SUCCESS' });
		expect(response.getHeader('X-VaultAPI-VaultId')).toBe('42');
		expect(response.headers['x-vaultapi-vaultid']).toBe('42');
	});

	it('wraps a non-JSON body in a synthetic FAILURE envelope', async () => {
		vi.stubGlobal('fetch', () => Promise.resolve(fakeResponse(502, '<html>Bad Gateway</html>')));

		const response = await new NodeHttpTransport().send(REQUEST, 1000);

		expect(response.body).toMatchObject({
			responseStatus: 'FAILURE',
			errors: [{ type: 'NON_JSON_RESPONSE', message: '<html>Bad Gateway</html>' }],
		});
	});

	it('returns raw bytes for a 2xx binary response', async () => {
		const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
		vi.stubGlobal('fetch', () =>
			Promise.resolve({
				status: 200,
				ok: true,
				headers: new Headers(),
				arrayBuffer: () => Promise.resolve(payload.buffer),
			}),
		);

		const response = await new NodeHttpTransport().send({ ...REQUEST, responseType: 'binary' });

		expect(response.body).toBeInstanceOf(Uint8Array);
		expect(response.body).toEqual(payload);
	});

	it('decodes a non-2xx binary request as a JSON envelope so failures still surface', async () => {
		vi.stubGlobal('fetch', () =>
			Promise.resolve({
				...fakeResponse(401, '{"responseStatus":"FAILURE","errors":[{"type":"INVALID_SESSION_ID","message":"x"}]}'),
				ok: false,
			}),
		);

		const response = await new NodeHttpTransport().send({ ...REQUEST, responseType: 'binary' });

		expect(response.body).toMatchObject({ responseStatus: 'FAILURE' });
	});

	it('throws a TIMEOUT VaultApiError when the request is aborted by the timeout', async () => {
		vi.stubGlobal(
			'fetch',
			(_url: string, init: { signal: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					init.signal.addEventListener('abort', () =>
						reject(new DOMException('The operation was aborted.', 'AbortError')),
					);
				}),
		);

		const error = await new NodeHttpTransport().send(REQUEST, 5).catch((caught) => caught);

		expect(error).toBeInstanceOf(VaultApiError);
		expect((error as VaultApiError).type).toBe('TIMEOUT');
	});

	it('wraps a non-abort network failure as a NETWORK_ERROR VaultApiError', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));

		const error = await new NodeHttpTransport().send(REQUEST, 1000).catch((caught) => caught);

		expect(error).toBeInstanceOf(VaultApiError);
		expect((error as VaultApiError).type).toBe('NETWORK_ERROR');
	});
});
