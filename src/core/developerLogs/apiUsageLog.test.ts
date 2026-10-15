import { describe, expect, it } from 'vitest';
import { VaultApiError } from '../rest/errors';
import {
	API_USAGE_LOG_MAX_AGE_DAYS,
	API_USAGE_LOG_PERMISSION,
	apiUsageLogDestinationSegments,
	apiUsageLogErrorMessage,
	apiUsageLogPartialFailureMessage,
	apiUsageLogRunSegments,
	encodeApiUsageLogQuery,
	validateApiUsageLogDate,
	validateApiUsageLogDates,
} from './apiUsageLog';

describe('encodeApiUsageLogQuery', () => {
	it('emits the date and format verbatim', () => {
		expect(encodeApiUsageLogQuery('2026-08-27', 'csv')).toEqual({
			date: '2026-08-27',
			log_format: 'csv',
		});
	});

	it('carries the logfile format when chosen', () => {
		expect(encodeApiUsageLogQuery('2026-08-01', 'logfile')).toEqual({
			date: '2026-08-01',
			log_format: 'logfile',
		});
	});
});

describe('apiUsageLogDestinationSegments', () => {
	it('groups all API Usage Logs for a Vault under <vaultId>/api-usage', () => {
		expect(apiUsageLogDestinationSegments('123456')).toEqual(['123456', 'api-usage']);
	});

	it('is the date-independent prefix of a run folder', () => {
		const destination = apiUsageLogDestinationSegments('123456');
		expect(apiUsageLogRunSegments('123456', '2026-08-27').slice(0, destination.length)).toEqual(
			destination,
		);
	});
});

describe('apiUsageLogRunSegments', () => {
	it('groups a download under <vaultId>/api-usage/<logDate>', () => {
		expect(apiUsageLogRunSegments('123456', '2026-08-27')).toEqual([
			'123456',
			'api-usage',
			'2026-08-27',
		]);
	});

	it('keys the folder on the log date so the same date refreshes in place', () => {
		const first = apiUsageLogRunSegments('123456', '2026-08-27');
		const again = apiUsageLogRunSegments('123456', '2026-08-27');
		expect(again).toEqual(first);
	});
});

describe('validateApiUsageLogDate', () => {
	// A mid-day "now" so the day-level math never straddles a UTC midnight boundary by accident.
	const utcNow = new Date('2026-08-27T13:45:00Z');

	it('rejects an empty date', () => {
		expect(validateApiUsageLogDate('', utcNow)).toEqual({
			valid: false,
			reason: expect.stringContaining('Choose a date'),
		});
	});

	it('rejects an unparseable date', () => {
		expect(validateApiUsageLogDate('not-a-date', utcNow).valid).toBe(false);
	});

	it('rejects a future date', () => {
		expect(validateApiUsageLogDate('2026-08-28', utcNow)).toEqual({
			valid: false,
			reason: expect.stringContaining('future'),
		});
	});

	it('accepts today (UTC), regardless of the time of day', () => {
		expect(validateApiUsageLogDate('2026-08-27', utcNow)).toEqual({ valid: true });
	});

	it('accepts the oldest retained day (exactly the max age back)', () => {
		// 30 days before 2026-08-27 is 2026-07-28.
		expect(validateApiUsageLogDate('2026-07-28', utcNow)).toEqual({ valid: true });
		expect(API_USAGE_LOG_MAX_AGE_DAYS).toBe(30);
	});

	it('rejects a day one past the max age', () => {
		// 31 days before 2026-08-27 is 2026-07-27.
		expect(validateApiUsageLogDate('2026-07-27', utcNow)).toEqual({
			valid: false,
			reason: expect.stringContaining('30 days'),
		});
	});
});

describe('validateApiUsageLogDates', () => {
	const utcNow = new Date('2026-08-27T13:45:00Z');

	it('rejects an empty selection', () => {
		expect(validateApiUsageLogDates([], utcNow)).toEqual({
			valid: false,
			reason: expect.stringContaining('at least one date'),
		});
	});

	it('accepts a selection where every date is individually valid', () => {
		expect(validateApiUsageLogDates(['2026-08-27', '2026-08-01', '2026-07-28'], utcNow)).toEqual({
			valid: true,
		});
	});

	it('surfaces the first offending date’s reason when any date is out of range', () => {
		// The second date is one past the 30-day retention window (31 days before 2026-08-27).
		expect(validateApiUsageLogDates(['2026-08-27', '2026-07-27'], utcNow)).toEqual({
			valid: false,
			reason: expect.stringContaining('30 days'),
		});
	});

	it('rejects a selection containing a future date', () => {
		expect(validateApiUsageLogDates(['2026-08-28'], utcNow)).toEqual({
			valid: false,
			reason: expect.stringContaining('future'),
		});
	});
});

describe('apiUsageLogErrorMessage', () => {
	it('names the missing permission for an INSUFFICIENT_ACCESS Vault error', () => {
		const error = new VaultApiError('INSUFFICIENT_ACCESS: access denied', 'INSUFFICIENT_ACCESS');
		const message = apiUsageLogErrorMessage(error);
		expect(message).toContain(API_USAGE_LOG_PERMISSION);
		expect(message).not.toContain('access denied');
	});

	it('names the missing permission for an INSUFFICIENT_PERMISSIONS Vault error', () => {
		const error = new VaultApiError('nope', 'INSUFFICIENT_PERMISSIONS');
		expect(apiUsageLogErrorMessage(error)).toContain(API_USAGE_LOG_PERMISSION);
	});

	it('matches the permission error type case-insensitively', () => {
		const error = new VaultApiError('nope', 'insufficient_access');
		expect(apiUsageLogErrorMessage(error)).toContain(API_USAGE_LOG_PERMISSION);
	});

	it('falls back to a generic failure carrying the reason for any other Vault error', () => {
		const error = new VaultApiError('INTERNAL_SERVER_ERROR: boom', 'INTERNAL_SERVER_ERROR');
		const message = apiUsageLogErrorMessage(error);
		expect(message).not.toContain(API_USAGE_LOG_PERMISSION);
		expect(message).toContain('INTERNAL_SERVER_ERROR: boom');
	});

	it('handles a plain Error', () => {
		expect(apiUsageLogErrorMessage(new Error('network down'))).toContain('network down');
	});

	it('handles a non-Error thrown value', () => {
		expect(apiUsageLogErrorMessage('kaboom')).toContain('kaboom');
	});
});

describe('apiUsageLogPartialFailureMessage', () => {
	it('names how many landed of how many and which days failed, with the reason', () => {
		const message = apiUsageLogPartialFailureMessage(
			3,
			['2026-08-20', '2026-08-19'],
			new Error('no log for that day'),
		);
		expect(message).toContain('Downloaded 3 of 5 logs');
		expect(message).toContain('2026-08-20, 2026-08-19');
		expect(message).toContain('no log for that day');
	});

	it('uses the singular noun for a single failed day', () => {
		const message = apiUsageLogPartialFailureMessage(4, ['2026-08-20'], new Error('boom'));
		expect(message).toContain('Downloaded 4 of 5 logs');
		expect(message).toContain('1 day');
	});

	it('names the missing permission when the failure is an access denial', () => {
		const error = new VaultApiError('nope', 'INSUFFICIENT_ACCESS');
		const message = apiUsageLogPartialFailureMessage(1, ['2026-08-20'], error);
		expect(message).toContain(API_USAGE_LOG_PERMISSION);
	});
});
