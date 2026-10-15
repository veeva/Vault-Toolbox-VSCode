import { describe, it, expect, vi } from 'vitest';
import { onEnvelope, postEnvelope } from './vscodeApi';
import { dispatchEnvelope, postMessageSpy } from './test/setup';

/**
 * Direct tests of the enveloped message wiring in `vscodeApi.ts` — the bus every feature client rides.
 * The store's own node unit test cannot reach this DOM `window`/`postMessage` layer. Covers the
 * inbound round-trip, the `postMessage` shape, the unmount teardown closure (vscodeApi.ts:35), and
 * wrong-channel isolation.
 */
describe('vscodeApi envelope bus', () => {
	it('delivers an inbound envelope on the subscribed channel to its handler', () => {
		const handler = vi.fn();
		onEnvelope('vql', handler);

		dispatchEnvelope('vql', { type: 'result', requestId: 'r1' });

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ type: 'result', requestId: 'r1' });
	});

	it('posts host-ward messages wrapped in their channel envelope', () => {
		postEnvelope('actions', { type: 'refresh' });

		expect(postMessageSpy).toHaveBeenCalledWith({
			channel: 'actions',
			message: { type: 'refresh' },
		});
	});

	it('does not deliver an envelope sent on a different channel', () => {
		const handler = vi.fn();
		onEnvelope('vql', handler);

		dispatchEnvelope('environments', { type: 'list' });

		expect(handler).not.toHaveBeenCalled();
	});

	it('removes its window listener on unsubscribe (teardown closure)', () => {
		const handler = vi.fn();
		const unsubscribe = onEnvelope('vql', handler);

		unsubscribe();
		dispatchEnvelope('vql', { type: 'result', requestId: 'r2' });

		expect(handler).not.toHaveBeenCalled();
	});
});
