/**
 * Pure request + destination model for the API Usage Log — one of the bespoke Developer Log types
 * (see ADR 0008). Kept vscode-free and transport-free so the query encoding and the on-disk layout are
 * unit-testable in isolation; the VaultClient and the host orchestration both build on this shape.
 */

import { VaultApiError } from '../rest/errors';
import { utcCalendarDay } from './logDate';
import { partialFailureMessage } from '../partialFailureMessage';

/** The download file format: `csv` (the default) or Vault's raw `logfile`. */
export type ApiUsageLogFormat = 'csv' | 'logfile';

/** The user-chosen scope of an API Usage Log download: one or more UTC calendar days plus a file format. */
export interface ApiUsageLogParameters {
	/** The chosen `yyyy-mm-dd` UTC calendar days; the host downloads one log per date. */
	dates: string[];
	logFormat: ApiUsageLogFormat;
}

/** The format the form opens pre-set to. */
export const DEFAULT_API_USAGE_LOG_FORMAT: ApiUsageLogFormat = 'csv';

/** How many UTC days back Vault retains API Usage Logs; older dates are rejected before requesting. */
export const API_USAGE_LOG_MAX_AGE_DAYS = 30;

/** The per-type folder segment API Usage Logs are grouped under, between the Vault id and the date. */
const API_USAGE_LOG_TYPE_SEGMENT = 'api-usage';

/**
 * Encode the query parameters Vault's `logs/api_usage` endpoint expects for one day: the required `date`
 * and the `log_format`. Both are always sent — the endpoint has no useful "omit for default" behaviour,
 * unlike the Configuration Report's optional scoping fields. The endpoint has no multi-date parameter, so
 * a multi-date download is the host issuing one encoded request per chosen day.
 */
export function encodeApiUsageLogQuery(date: string, logFormat: ApiUsageLogFormat): Record<string, string> {
	return {
		date,
		log_format: logFormat,
	};
}

/**
 * The date-independent folder segments all of a Vault's API Usage Logs are grouped under, below the
 * configured Developer Logs directory: `<vaultId>/api-usage`. Used both to build a run folder (see
 * {@link apiUsageLogRunSegments}) and as the form's write-location preview, so the two never drift.
 */
export function apiUsageLogDestinationSegments(vaultId: string): string[] {
	return [vaultId, API_USAGE_LOG_TYPE_SEGMENT];
}

/**
 * The workspace-relative folder segments one API Usage Log download is written under, below the
 * configured Developer Logs directory: `<vaultId>/api-usage/<logDate>`. Keyed by log date (not a run
 * timestamp) so re-downloading the same date refreshes the file in place rather than accumulating
 * duplicate snapshot folders.
 */
export function apiUsageLogRunSegments(vaultId: string, logDate: string): string[] {
	return [...apiUsageLogDestinationSegments(vaultId), logDate];
}

/** Whether a chosen date can be requested, or the reason it can't — for inline form feedback. */
export type ApiUsageLogDateValidation = { valid: true } | { valid: false; reason: string };

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Validate a chosen log date against what Vault will accept, computed entirely in UTC so it matches how
 * the endpoint interprets `date`. "UTC now" is injected rather than read from the clock so the rules are
 * deterministically unit-testable. Rejects an empty or unparseable date, a future day, and any day more
 * than {@link API_USAGE_LOG_MAX_AGE_DAYS} back; today and the oldest retained day are both valid.
 */
export function validateApiUsageLogDate(date: string, utcNow: Date): ApiUsageLogDateValidation {
	if (date === '') {
		return { valid: false, reason: 'Choose a date to download the log for.' };
	}
	const chosenDayStart = Date.parse(`${date}T00:00:00Z`);
	if (Number.isNaN(chosenDayStart)) {
		return { valid: false, reason: 'Enter a valid calendar date (yyyy-mm-dd).' };
	}
	const todayStart = Date.parse(`${utcCalendarDay(utcNow)}T00:00:00Z`);
	const daysBack = Math.round((todayStart - chosenDayStart) / MILLIS_PER_DAY);
	if (daysBack < 0) {
		return { valid: false, reason: 'The date can’t be in the future (UTC).' };
	}
	if (daysBack > API_USAGE_LOG_MAX_AGE_DAYS) {
		return {
			valid: false,
			reason: `Vault keeps API Usage Logs for ${API_USAGE_LOG_MAX_AGE_DAYS} days; choose a more recent date.`,
		};
	}
	return { valid: true };
}

/** Whether the chosen set of dates can be submitted, or the single reason it can't — for form feedback. */
export type ApiUsageLogDatesValidation = { valid: true } | { valid: false; reason: string };

/**
 * Validate the whole selection the multi-date form submits: at least one date, and every date individually
 * acceptable ({@link validateApiUsageLogDate}). The calendar already blocks out-of-range days, so this is
 * mainly the empty-selection guard plus defence in depth against a date that slipped through. The first
 * offending date's reason is surfaced so the message stays specific.
 */
export function validateApiUsageLogDates(dates: string[], utcNow: Date): ApiUsageLogDatesValidation {
	if (dates.length === 0) {
		return { valid: false, reason: 'Choose at least one date to download the log for.' };
	}
	for (const date of dates) {
		const perDate = validateApiUsageLogDate(date, utcNow);
		if (!perDate.valid) {
			return { valid: false, reason: perDate.reason };
		}
	}
	return { valid: true };
}

/** The Vault admin permission the `logs/api_usage` endpoint requires; named in the denial message. */
export const API_USAGE_LOG_PERMISSION = 'Admin: Logs: API Usage Logs';

/** Vault error `type`s that mean the user lacks the permission, rather than a transient failure. */
const INSUFFICIENT_ACCESS_TYPES = ['INSUFFICIENT_ACCESS', 'INSUFFICIENT_PERMISSIONS'];

/** Whether a thrown value is a Vault failure signalling the user lacks the endpoint's permission. */
function isInsufficientAccess(error: unknown): boolean {
	return (
		error instanceof VaultApiError &&
		INSUFFICIENT_ACCESS_TYPES.includes(error.type.toUpperCase())
	);
}

/** A human-readable message for any thrown value, mirroring the host's `errorMessage`. */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The specific reason an API Usage Log download failed, without the "Download … failed" framing. A Vault
 * insufficient-permissions failure names the permission to grant ({@link API_USAGE_LOG_PERMISSION}); every
 * other failure yields the underlying error message. Reused both for the whole-download error message and,
 * when only some days of a multi-date download fail, for the partial-failure message.
 */
export function apiUsageLogFailureReason(error: unknown): string {
	if (isInsufficientAccess(error)) {
		return `you don’t have permission — ask a Vault admin to grant the “${API_USAGE_LOG_PERMISSION}” permission.`;
	}
	return errorMessage(error);
}

/**
 * Map a failed API Usage Log download to the message the form shows inline when every requested day failed.
 * A Vault insufficient-permissions failure names the specific permission to grant so the developer knows
 * the fix is a Vault-side grant, not a retry; every other failure falls back to a generic message carrying
 * the underlying reason. Pure and transport-free so it is unit-testable.
 */
export function apiUsageLogErrorMessage(error: unknown): string {
	if (isInsufficientAccess(error)) {
		return `You don’t have permission to download the API Usage Log. Ask a Vault admin to grant the “${API_USAGE_LOG_PERMISSION}” permission.`;
	}
	return `Download API Usage Log failed: ${errorMessage(error)}`;
}

/**
 * The inline message shown when a multi-date download partially succeeded: some days wrote, others failed.
 * Names how many of how many landed and which days didn't, plus the {@link apiUsageLogFailureReason} of the
 * first failure. The successful days are already on disk; the developer stays on the form to retry the rest.
 */
export function apiUsageLogPartialFailureMessage(
	okCount: number,
	failedDates: string[],
	error: unknown,
): string {
	return partialFailureMessage(okCount, failedDates, apiUsageLogFailureReason(error), {
		successVerb: 'Downloaded',
		successNoun: 'logs',
		failedItemNoun: 'day',
	});
}
