import { describe, expect, it } from 'vitest';
import {
	formatDuration,
	isAuthUrl,
	isJsonContentType,
	methodClass,
	redactRequestHeaders,
	serializeRequestBody,
	serializeResponseBody,
	statusClass,
	statusLabel,
	stripOrigin,
} from './apiHistory';

const AUTH_URL = 'https://myco.veevavault.com/api/v26.1/auth';
const QUERY_URL = 'https://myco.veevavault.com/api/v26.1/query';

describe('redactRequestHeaders', () => {
	it('drops the Authorization header case-insensitively and keeps the rest', () => {
		const result = redactRequestHeaders({
			authorization: 'sessionToken123',
			'X-VaultAPI-ClientID': 'toolbox',
		});
		expect(result).toEqual({ 'X-VaultAPI-ClientID': 'toolbox' });
	});

	it('returns an empty object for absent headers', () => {
		expect(redactRequestHeaders(undefined)).toEqual({});
	});
});

describe('serializeRequestBody', () => {
	it('redacts username and password on the auth endpoint', () => {
		const body = new URLSearchParams();
		body.append('username', 'user@myco.com');
		body.append('password', 'hunter2');
		body.append('vaultDNS', 'myco.veevavault.com');

		const result = serializeRequestBody(body, AUTH_URL);

		expect(result).not.toContain('hunter2');
		expect(result).not.toContain('user%40myco.com');
		expect(result).toContain('username=***');
		expect(result).toContain('password=***');
		expect(result).toContain('vaultDNS=myco.veevavault.com');
	});

	it('passes a non-auth form body through unredacted', () => {
		const body = new URLSearchParams();
		body.append('q', 'SELECT id FROM documents');
		expect(serializeRequestBody(body, QUERY_URL)).toBe('q=SELECT+id+FROM+documents');
	});

	it('returns null for an absent body', () => {
		expect(serializeRequestBody(undefined, QUERY_URL)).toBeNull();
	});
});

describe('serializeResponseBody', () => {
	it('redacts the sessionId on the auth endpoint', () => {
		const parsed = { responseStatus: 'SUCCESS', sessionId: 'secret-session', userId: 42 };
		const result = serializeResponseBody(parsed, AUTH_URL);
		expect(result).not.toContain('secret-session');
		expect(result).toContain('"sessionId":"***"');
		expect(result).toContain('"userId":42');
	});

	it('passes a non-auth body through unchanged, sessionId included', () => {
		const parsed = { data: [1, 2], sessionId: 'not-actually-a-session' };
		expect(serializeResponseBody(parsed, QUERY_URL)).toBe(
			'{"data":[1,2],"sessionId":"not-actually-a-session"}',
		);
	});

	it('stringifies a body unchanged', () => {
		expect(serializeResponseBody({ data: [1, 2] }, QUERY_URL)).toBe('{"data":[1,2]}');
	});

	it('returns null for an absent body', () => {
		expect(serializeResponseBody(null, QUERY_URL)).toBeNull();
	});

	it('records a genuinely binary body as its size, not its bytes', () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		expect(
			serializeResponseBody(bytes, QUERY_URL, { 'content-type': 'application/octet-stream' }),
		).toBe('[binary 4 bytes]');
	});

	it('records a size when a binary body carries no content-type headers', () => {
		expect(serializeResponseBody(new Uint8Array([1, 2, 3]), QUERY_URL)).toBe('[binary 3 bytes]');
	});

	it('decodes a binary body as text when the response is JSON (a FAILURE envelope, not bytes)', () => {
		const envelope = '{"responseStatus":"FAILURE","errors":[{"type":"INVALID_DATA","message":"File not found."}]}';
		const bytes = new TextEncoder().encode(envelope);
		expect(serializeResponseBody(bytes, QUERY_URL, { 'Content-Type': 'application/json' })).toBe(
			envelope,
		);
	});
});

describe('isAuthUrl', () => {
	it('is true for the auth endpoint and false for others', () => {
		expect(isAuthUrl(AUTH_URL)).toBe(true);
		expect(isAuthUrl(QUERY_URL)).toBe(false);
	});
});

describe('isJsonContentType', () => {
	it('is true for application/json, including a charset parameter', () => {
		expect(isJsonContentType({ 'content-type': 'application/json' })).toBe(true);
		expect(isJsonContentType({ 'content-type': 'application/json; charset=UTF-8' })).toBe(true);
	});

	it('matches the header name case-insensitively', () => {
		expect(isJsonContentType({ 'Content-Type': 'application/json' })).toBe(true);
	});

	it('is false for other content types and when the header is absent', () => {
		expect(isJsonContentType({ 'content-type': 'text/csv' })).toBe(false);
		expect(isJsonContentType({})).toBe(false);
	});
});

describe('stripOrigin', () => {
	it('returns pathname + search without the origin', () => {
		expect(stripOrigin('https://myco.veevavault.com/api/v26.1/query?x=1')).toBe('/api/v26.1/query?x=1');
	});

	it('returns the input unchanged when it is not a URL', () => {
		expect(stripOrigin('/api/v26.1/query')).toBe('/api/v26.1/query');
	});
});

describe('statusLabel', () => {
	it('renders the numeric status', () => {
		expect(statusLabel(200)).toBe('200');
	});

	it('renders ERR when there is no status', () => {
		expect(statusLabel(null)).toBe('ERR');
	});
});

describe('methodClass / statusClass', () => {
	it('lowercases the method', () => {
		expect(methodClass('POST')).toBe('post');
	});

	it('buckets status codes and maps a null status to error', () => {
		expect(statusClass(200)).toBe('ok');
		expect(statusClass(301)).toBe('redirect');
		expect(statusClass(404)).toBe('client-error');
		expect(statusClass(500)).toBe('server-error');
		expect(statusClass(null)).toBe('error');
	});
});

describe('formatDuration', () => {
	it('uses ms below a second and seconds above', () => {
		expect(formatDuration(42)).toBe('42 ms');
		expect(formatDuration(1500)).toBe('1.50 s');
	});
});
