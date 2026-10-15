import { describe, it, expect } from 'vitest';
import { normalizeError } from './vqlProtocol';
import { VaultApiError } from '../core/rest/errors';

describe('normalizeError', () => {
	it('normalizes a VaultApiError, stripping the type prefix and keeping the response', () => {
		const response = { responseStatus: 'FAILURE', errors: [{ type: 'MALFORMED_QUERY', message: 'bad vql' }] };
		expect(normalizeError(new VaultApiError('MALFORMED_QUERY: bad vql', 'MALFORMED_QUERY', response))).toEqual({
			type: 'MALFORMED_QUERY',
			message: 'bad vql',
			response,
		});
	});

	it('normalizes a plain Error using its name', () => {
		expect(normalizeError(new Error('boom'))).toEqual({ type: 'Error', message: 'boom' });
	});

	it('passes through an already-NormalizedError-shaped plain object (the webview postMessage case)', () => {
		const response = { responseStatus: 'FAILURE' };
		expect(normalizeError({ type: 'MALFORMED_QUERY', message: 'bad vql', response })).toEqual({
			type: 'MALFORMED_QUERY',
			message: 'bad vql',
			response,
		});
	});

	it('defaults type to ERROR when a plain object has a message but no string type', () => {
		expect(normalizeError({ message: 'timed out' })).toEqual({ type: 'ERROR', message: 'timed out' });
	});

	it('falls back to String(e) for a completely unshaped value', () => {
		expect(normalizeError('nope')).toEqual({ type: 'ERROR', message: 'nope' });
	});
});
