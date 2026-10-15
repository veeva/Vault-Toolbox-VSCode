/**
 * Polls a Vault async job to a terminal outcome at the documented cadence, honouring cancellation
 * throughout. This is the generic control flow ADR 0007 first needed for the Configuration Report and
 * that the VPK Deploy pipeline reuses; the caller supplies how to read a status (`fetchStatus`), owns
 * whatever it does with a finished job's artifacts, and receives one union covering every way polling
 * can end.
 *
 * vscode-free by design: progress is surfaced through the `onTick` callback rather than a
 * `vscode.Progress`, and the wait is an injected `sleep` (defaulting to {@link cancellableDelay}) so
 * the loop's state machine is unit-testable without real time.
 */

import { decideJobAction, type JobStatus } from './jobStatus';

/** Documented job-poll cadence (see CONTEXT.md job-polling note); also respects Vault's once-per-10s
 * job-status rate limit. Callers may override per job type via {@link PollJobOptions}. */
export const DEFAULT_POLL_INTERVAL_MS = 11_000;
export const DEFAULT_MAX_POLL_RETRIES = 20;

/** How one poll run ended. `succeeded`/`succeeded-with-issues` carry the terminal status so the caller
 * can locate artifacts; `failed` carries the raw Vault status for messaging. */
export type PollOutcome =
	| { kind: 'succeeded'; status: JobStatus }
	| { kind: 'succeeded-with-issues'; status: JobStatus }
	| { kind: 'failed'; status: string }
	| { kind: 'graceful-timeout' }
	| { kind: 'cancelled' };

export interface PollJobOptions {
	/** Consulted before every status read and inside the wait; a `true` result ends polling as `cancelled`. */
	isCancelled: () => boolean;
	/** Called on each keep-polling tick (after classification, before the wait), for progress reporting. */
	onTick?: (info: { status: JobStatus; retriesRemaining: number }) => void;
	/** Poll interval in ms. Defaults to {@link DEFAULT_POLL_INTERVAL_MS}. */
	intervalMs?: number;
	/** Maximum still-running reads before a graceful timeout. Defaults to {@link DEFAULT_MAX_POLL_RETRIES}. */
	maxRetries?: number;
	/** Injectable wait so tests can advance without real time. Defaults to {@link cancellableDelay}. */
	sleep?: (ms: number, isCancelled: () => boolean) => Promise<void>;
}

/**
 * Poll `fetchStatus` until the job reaches a terminal outcome, is cancelled, or exhausts its retries. A
 * rejection from `fetchStatus` (a network or unrecoverable auth error) propagates — a transport failure
 * is not a terminal job status, and the caller already handles it.
 */
export async function pollJob(
	fetchStatus: () => Promise<JobStatus>,
	options: PollJobOptions,
): Promise<PollOutcome> {
	const {
		isCancelled,
		onTick,
		intervalMs = DEFAULT_POLL_INTERVAL_MS,
		maxRetries = DEFAULT_MAX_POLL_RETRIES,
		sleep = cancellableDelay,
	} = options;

	let retriesRemaining = maxRetries;
	for (;;) {
		if (isCancelled()) {
			return { kind: 'cancelled' };
		}
		const status = await fetchStatus();
		const action = decideJobAction(status.status, retriesRemaining);
		switch (action.kind) {
			case 'succeeded':
				return { kind: 'succeeded', status };
			case 'succeeded-with-issues':
				return { kind: 'succeeded-with-issues', status };
			case 'failed':
				return { kind: 'failed', status: action.status };
			case 'graceful-timeout':
				return { kind: 'graceful-timeout' };
			case 'keep-polling':
				retriesRemaining -= 1;
				onTick?.({ status, retriesRemaining });
				await sleep(intervalMs, isCancelled);
		}
	}
}

/** Wait `ms`, checking `isCancelled` in small steps so cancellation is honoured mid-wait. */
export async function cancellableDelay(ms: number, isCancelled: () => boolean): Promise<void> {
	const step = 250;
	let waited = 0;
	while (waited < ms && !isCancelled()) {
		const slice = Math.min(step, ms - waited);
		await new Promise((resolve) => setTimeout(resolve, slice));
		waited += slice;
	}
}
