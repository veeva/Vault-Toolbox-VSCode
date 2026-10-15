import { describe, it, expect } from 'vitest';
import { decideJobAction } from './jobStatus';

describe('decideJobAction', () => {
	it('succeeds on a clean terminal success', () => {
		expect(decideJobAction('SUCCESS', 20)).toEqual({ kind: 'succeeded' });
		expect(decideJobAction('COMPLETED', 20)).toEqual({ kind: 'succeeded' });
	});

	it('is case-insensitive to Vault status casing', () => {
		expect(decideJobAction('success', 20)).toEqual({ kind: 'succeeded' });
	});

	it('succeeds with issues when config issues were encountered', () => {
		expect(decideJobAction('ERRORS_ENCOUNTERED', 20)).toEqual({ kind: 'succeeded-with-issues' });
	});

	it('fails on every failed terminal status, carrying the raw status', () => {
		for (const status of ['FAILED', 'CANCELLED', 'TIMEOUT', 'MISSED_SCHEDULE', 'COMPLETED_DUE_TO_INACTIVITY']) {
			expect(decideJobAction(status, 20)).toEqual({ kind: 'failed', status });
		}
	});

	it('keeps polling while still running and retries remain', () => {
		expect(decideJobAction('RUNNING', 5)).toEqual({ kind: 'keep-polling' });
		expect(decideJobAction('QUEUED', 1)).toEqual({ kind: 'keep-polling' });
	});

	it('gracefully times out when still running and retries are exhausted', () => {
		expect(decideJobAction('RUNNING', 0)).toEqual({ kind: 'graceful-timeout' });
	});
});
