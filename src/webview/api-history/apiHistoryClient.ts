import type { ApiHistoryEntry, HostToApiHistoryMessage } from '../../shared/apiHistoryProtocol';
import { onEnvelope, postEnvelope } from '../vscodeApi';

/**
 * Webview half of the API History bus, on the `apiHistory` channel of the shell envelope. The host
 * owns the log: on `ready` it pushes a full snapshot, then one message per newly recorded call, plus a
 * `cleared` when the log is wiped.
 */

/** Subscribe to host-pushed history messages (snapshot / entry / cleared). Returns an unsubscribe. */
export function onApiHistory(handler: (message: HostToApiHistoryMessage) => void): () => void {
	return onEnvelope('apiHistory', (message) => handler(message as HostToApiHistoryMessage));
}

/** Ask the host to push the current snapshot (called once on mount). */
export function requestApiHistory(): void {
	postEnvelope('apiHistory', { type: 'ready' });
}

/** Ask the host to clear the in-memory log. */
export function clearApiHistory(): void {
	postEnvelope('apiHistory', { type: 'clear' });
}

export type { ApiHistoryEntry };
