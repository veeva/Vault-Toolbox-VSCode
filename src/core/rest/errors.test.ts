import { describe, expect, it } from 'vitest';
import { isInvalidSession, isVaultResponse } from './errors';

describe('isVaultResponse', () => {
	it('accepts an object with a string responseStatus', () => {
		expect(isVaultResponse({ responseStatus: 'SUCCESS' })).toBe(true);
	});

	it('rejects non-objects and objects missing responseStatus', () => {
		expect(isVaultResponse(null)).toBe(false);
		expect(isVaultResponse('SUCCESS')).toBe(false);
		expect(isVaultResponse({ status: 'SUCCESS' })).toBe(false);
		expect(isVaultResponse({ responseStatus: 200 })).toBe(false);
	});
});

describe('isInvalidSession', () => {
	it('matches a string message case-insensitively', () => {
		expect(isInvalidSession('errorType: invalid_session_id')).toBe(true);
	});

	it("matches an Error's message", () => {
		expect(isInvalidSession(new Error('INVALID_SESSION_ID: expired'))).toBe(true);
	});

	it('matches a Vault response error by type', () => {
		expect(
			isInvalidSession({
				responseStatus: 'FAILURE',
				errors: [{ type: 'INVALID_SESSION_ID', message: 'Session expired.' }],
			}),
		).toBe(true);
	});

	it('is false when nothing indicates an expired session', () => {
		expect(isInvalidSession('some other error')).toBe(false);
		expect(
			isInvalidSession({
				responseStatus: 'FAILURE',
				errors: [{ type: 'MALFORMED_QUERY', message: 'Bad query.' }],
			}),
		).toBe(false);
	});
});
