import { describe, it, expect, vi } from 'vitest';
import { cancellableDelay, pollJob } from './pollJob';
import type { JobStatus } from './jobStatus';

/** A status with no links; the loop only reads `.status` until it decides to finish. */
function running(status: string): JobStatus {
	return { status, links: [] };
}

/** An instant, non-waiting sleep so the state machine runs without real time. */
const instantSleep = () => Promise.resolve();

/** Returns a `fetchStatus` that yields each status in order, repeating the last once exhausted. */
function statusSequence(statuses: string[]): () => Promise<JobStatus> {
	let index = 0;
	return () => {
		const status = statuses[Math.min(index, statuses.length - 1)];
		index += 1;
		return Promise.resolve(running(status));
	};
}

describe('pollJob', () => {
	it('returns succeeded with the terminal status after keep-polling', async () => {
		const outcome = await pollJob(statusSequence(['RUNNING', 'RUNNING', 'SUCCESS']), {
			isCancelled: () => false,
			sleep: instantSleep,
		});
		expect(outcome).toEqual({ kind: 'succeeded', status: running('SUCCESS') });
	});

	it('returns succeeded-with-issues on ERRORS_ENCOUNTERED', async () => {
		const outcome = await pollJob(statusSequence(['ERRORS_ENCOUNTERED']), {
			isCancelled: () => false,
			sleep: instantSleep,
		});
		expect(outcome).toEqual({ kind: 'succeeded-with-issues', status: running('ERRORS_ENCOUNTERED') });
	});

	it('returns failed carrying the raw status', async () => {
		const outcome = await pollJob(statusSequence(['FAILED']), {
			isCancelled: () => false,
			sleep: instantSleep,
		});
		expect(outcome).toEqual({ kind: 'failed', status: 'FAILED' });
	});

	it('gracefully times out after exactly maxRetries still-running reads', async () => {
		const fetchStatus = vi.fn(() => Promise.resolve(running('RUNNING')));
		const outcome = await pollJob(fetchStatus, {
			isCancelled: () => false,
			sleep: instantSleep,
			maxRetries: 3,
		});
		expect(outcome).toEqual({ kind: 'graceful-timeout' });
		// 3 reads decrement retries to 0, the 4th read classifies as graceful-timeout.
		expect(fetchStatus).toHaveBeenCalledTimes(4);
	});

	it('cancels before reading when already cancelled', async () => {
		const fetchStatus = vi.fn(() => Promise.resolve(running('RUNNING')));
		const outcome = await pollJob(fetchStatus, {
			isCancelled: () => true,
			sleep: instantSleep,
		});
		expect(outcome).toEqual({ kind: 'cancelled' });
		expect(fetchStatus).not.toHaveBeenCalled();
	});

	it('cancels between ticks once isCancelled flips', async () => {
		let cancelled = false;
		const outcome = await pollJob(statusSequence(['RUNNING', 'RUNNING']), {
			isCancelled: () => cancelled,
			sleep: () => {
				cancelled = true;
				return Promise.resolve();
			},
		});
		expect(outcome).toEqual({ kind: 'cancelled' });
	});

	it('fires onTick on each keep-polling tick with remaining retries', async () => {
		const ticks: number[] = [];
		await pollJob(statusSequence(['RUNNING', 'RUNNING', 'SUCCESS']), {
			isCancelled: () => false,
			sleep: instantSleep,
			maxRetries: 20,
			onTick: ({ retriesRemaining }) => ticks.push(retriesRemaining),
		});
		expect(ticks).toEqual([19, 18]);
	});

	it('propagates a fetchStatus rejection rather than swallowing it', async () => {
		await expect(
			pollJob(() => Promise.reject(new Error('network down')), {
				isCancelled: () => false,
				sleep: instantSleep,
			}),
		).rejects.toThrow('network down');
	});
});

describe('cancellableDelay', () => {
	it('waits the full duration in steps when never cancelled', async () => {
		vi.useFakeTimers();
		try {
			const done = vi.fn();
			const promise = cancellableDelay(1_000, () => false).then(done);
			await vi.advanceTimersByTimeAsync(1_000);
			await promise;
			expect(done).toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('stops early once isCancelled turns true mid-wait', async () => {
		vi.useFakeTimers();
		try {
			let cancelled = false;
			const promise = cancellableDelay(10_000, () => cancelled);
			// Let the first 250ms step elapse, then cancel; the next step check ends the wait.
			await vi.advanceTimersByTimeAsync(250);
			cancelled = true;
			await vi.advanceTimersByTimeAsync(250);
			await expect(promise).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});
