/**
 * Holds a single in-flight {@link AbortController} so long-running bus operations can be cancelled
 * cleanly. Multiple features (compare, config report, developer logs) share this same pattern of
 * abort-previous → create → await → suppress-if-aborted; this class names that lifecycle.
 */
export class AbortSlot {
	private controller: AbortController | undefined;

	/** Start `fn`, posting its result unless {@link abort} was called before it resolves. */
	async run<T>(fn: (signal: AbortSignal) => Promise<T>, post: (result: T) => void): Promise<void> {
		this.controller?.abort();
		const ctrl = new AbortController();
		this.controller = ctrl;
		const result = await fn(ctrl.signal);
		if (!ctrl.signal.aborted) {
			post(result);
		}
	}

	/** Abort the in-flight operation started by the last {@link run} call, if any. */
	abort(): void {
		this.controller?.abort();
	}
}
