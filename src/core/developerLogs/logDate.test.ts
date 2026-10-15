import { describe, expect, it } from 'vitest';
import { shiftUtcCalendarDay, utcCalendarDay } from './logDate';

describe('utcCalendarDay', () => {
	it('takes the UTC date of an instant, regardless of the time of day', () => {
		expect(utcCalendarDay(new Date('2026-08-27T23:59:00Z'))).toBe('2026-08-27');
	});
});

describe('shiftUtcCalendarDay', () => {
	it('reaches back by whole days', () => {
		expect(shiftUtcCalendarDay('2026-08-27', -30)).toBe('2026-07-28');
	});

	it('reaches forward by whole days', () => {
		expect(shiftUtcCalendarDay('2026-08-27', 5)).toBe('2026-09-01');
	});

	it('returns the same day for a zero shift', () => {
		expect(shiftUtcCalendarDay('2026-08-27', 0)).toBe('2026-08-27');
	});

	it('crosses a year boundary going back', () => {
		expect(shiftUtcCalendarDay('2026-01-05', -10)).toBe('2025-12-26');
	});
});
