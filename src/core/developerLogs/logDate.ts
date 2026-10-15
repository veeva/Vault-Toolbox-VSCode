/**
 * The UTC calendar day (`yyyy-mm-dd`) an instant falls on — the day both Developer Log forms default to
 * and both date validators compare against. A shared pure helper, not a download pipeline, so ADR 0008's
 * bespoke-per-type rule doesn't apply: the calendar-day math is identical for every log type and for the
 * webview's default date, so it lives in one place rather than being copied per type.
 */
export function utcCalendarDay(instant: Date): string {
	return instant.toISOString().slice(0, 10);
}

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The UTC calendar day `deltaDays` away from a given `yyyy-mm-dd` (negative reaches back), returned as
 * `yyyy-mm-dd`. Used to bound the log calendars' selectable window (today back to the retention limit).
 * Pure UTC math so it can't drift with the local zone or the clock.
 */
export function shiftUtcCalendarDay(day: string, deltaDays: number): string {
	const base = Date.parse(`${day}T00:00:00Z`);
	return new Date(base + deltaDays * MILLIS_PER_DAY).toISOString().slice(0, 10);
}
