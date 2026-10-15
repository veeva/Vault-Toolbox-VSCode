import type { Channel, ShellEnvelope } from '../../shared/shellProtocol';

/**
 * Shared `acquireVsCodeApi` stub + inbound-message helper used by both the jsdom (`setup.ts`) and
 * real-browser (`browserSetup.ts`) tiers. `webview/vscodeApi.ts` calls `acquireVsCodeApi()` at module
 * load and caches the result, so a stub must exist on `globalThis` before any webview module imports —
 * both setups call `installVsCodeApiStub()` before their first test import runs.
 */

/**
 * Install a stub `acquireVsCodeApi` on `globalThis`. `onPost` receives every host-ward `postMessage`
 * (the jsdom tier passes a spy to assert on; the browser tier passes nothing). `getState`/`setState`
 * back onto a per-install in-memory slot, standing in for the host's persisted view state. Returns a
 * `resetState` the caller can run between tests to clear that slot.
 */
export function installVsCodeApiStub(
	onPost: (envelope: ShellEnvelope) => void = () => {},
): { resetState: () => void } {
	let persistedState: unknown;
	const vsCodeApiStub = {
		postMessage: onPost,
		getState: (): unknown => persistedState,
		setState: (state: unknown): void => {
			persistedState = state;
		},
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).acquireVsCodeApi = (): typeof vsCodeApiStub => vsCodeApiStub;
	return {
		resetState: (): void => {
			persistedState = undefined;
		},
	};
}

/**
 * Fire an inbound host → webview message on `channel`, shaped exactly like the real host post so
 * `onEnvelope`'s `window` listener (vscodeApi.ts) unwraps it. Use in place of the extension host.
 */
export function dispatchEnvelope(channel: Channel, message: unknown): void {
	window.dispatchEvent(new MessageEvent<ShellEnvelope>('message', { data: { channel, message } }));
}
