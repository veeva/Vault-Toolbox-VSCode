/**
 * Pure decision logic for polling a Vault async job to completion. Kept transport-free so the status →
 * next-action mapping is unit-testable across every terminal status without a live Vault; the
 * {@link pollJob} loop owns the timers and cancellation, and the caller owns the job's artifacts.
 *
 * This is the repo's job-polling foundation (see ADR 0007): the Configuration Report is its first
 * caller and the VPK Deploy pipeline its next. The vocabulary is deliberately job-framed
 * (`succeeded`/`failed`/…) rather than artifact-framed, so a caller that does not download anything
 * still reads naturally.
 */

/** One HAL-style link from a job-status response's `data.links[]`. */
export interface JobStatusLink {
	rel: string;
	href: string;
}

/** A polled job's status: its raw Vault `status` string plus any download links present once finished. */
export interface JobStatus {
	status: string;
	links: JobStatusLink[];
}

/**
 * What the poll loop should do next after reading a job's status:
 * - `succeeded` — the job finished cleanly.
 * - `succeeded-with-issues` — finished, but Vault reported configuration issues (an error log exists).
 * - `failed` — the job reached a failed terminal status; carries the raw status for messaging.
 * - `keep-polling` — still running with retries left; poll again after the interval.
 * - `graceful-timeout` — still running but out of retries; the job continues in Vault (not a failure).
 */
export type JobAction =
	| { kind: 'succeeded' }
	| { kind: 'succeeded-with-issues' }
	| { kind: 'failed'; status: string }
	| { kind: 'keep-polling' }
	| { kind: 'graceful-timeout' };

/** Terminal statuses that mean the job finished cleanly (see CONTEXT.md job-polling note). */
const SUCCESS_STATUSES = new Set(['SUCCESS', 'COMPLETED']);

/** Terminal statuses that mean the job failed and produced no usable artifact. */
const FAILURE_STATUSES = new Set([
	'FAILED',
	'CANCELLED',
	'TIMEOUT',
	'MISSED_SCHEDULE',
	'COMPLETED_DUE_TO_INACTIVITY',
]);

/**
 * Map a job's current status to the next action. A non-terminal (still-running) status keeps polling
 * while `retriesRemaining` is positive, and becomes a graceful timeout once retries are exhausted — a
 * long-running job is not a failure. `ERRORS_ENCOUNTERED` is kept distinct from a clean success so the
 * caller can also fetch the error log.
 */
export function decideJobAction(status: string, retriesRemaining: number): JobAction {
	const normalized = status.toUpperCase();
	if (SUCCESS_STATUSES.has(normalized)) {
		return { kind: 'succeeded' };
	}
	if (normalized === 'ERRORS_ENCOUNTERED') {
		return { kind: 'succeeded-with-issues' };
	}
	if (FAILURE_STATUSES.has(normalized)) {
		return { kind: 'failed', status };
	}
	return retriesRemaining > 0 ? { kind: 'keep-polling' } : { kind: 'graceful-timeout' };
}
