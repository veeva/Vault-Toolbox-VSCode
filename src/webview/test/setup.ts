import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { ShellEnvelope } from '../../shared/shellProtocol';
import { installVsCodeApiStub } from './vsCodeApiStub';

/**
 * jsdom-tier setup. `webview/vscodeApi.ts` calls `acquireVsCodeApi()` at module load and caches the
 * result in a module-scoped `const`, so the stub must exist on `globalThis` *before* any webview
 * module is imported. Vitest runs `setupFiles` before the test file's own imports, so installing it
 * here unblocks the entire jsdom tier. See spec "Keystone shim".
 */

/** Spy on every `postMessage` the webview sends host-ward; tests assert channel/message on it. */
export const postMessageSpy = vi.fn<(envelope: ShellEnvelope) => void>();

const { resetState } = installVsCodeApiStub((envelope) => {
	postMessageSpy(envelope);
});

// Re-exported so jsdom tests import the inbound-message helper alongside the spy from one place.
export { dispatchEnvelope } from './vsCodeApiStub';

afterEach(() => {
	cleanup();
	postMessageSpy.mockClear();
	resetState();
});
