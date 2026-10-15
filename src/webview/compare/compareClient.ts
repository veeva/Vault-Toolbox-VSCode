import type {
	CompareRequest,
	CompareSessionState,
	HostToCompareMessage,
} from '../../shared/compareProtocol';
import { onEnvelope, postEnvelope } from '../vscodeApi';

/**
 * Webview half of the Compare Environments bus, on the `compareEnvironments` channel of the shell
 * envelope. The selector starts or cancels a comparison; the host posts the outcome back so the
 * selector can show a loading state, dismiss on success, or surface a failure inline.
 */

/** Start a comparison for the given request; the host connects both Environments and renders the diff. */
export function startCompare(request: CompareRequest): void {
	postEnvelope('compareEnvironments', { type: 'startCompare', ...request });
}

/** Abort the in-flight compare started by the last {@link startCompare} call. */
export function cancelCompare(): void {
	postEnvelope('compareEnvironments', { type: 'cancelCompare' });
}

/**
 * Subscribe to the compare-result message the host posts once authentication and the fetch complete
 * (or fail). Returns an unsubscribe function. The selector stays visible until this fires so the
 * loading state and any inline error are always tied to a real host response.
 */
export function onCompareResult(
	callback: (message: HostToCompareMessage & { type: 'compareResult' }) => void,
): () => void {
	return onEnvelope('compareEnvironments', (raw) => {
		const message = raw as HostToCompareMessage;
		if (message?.type === 'compareResult') {
			callback(message);
		}
	});
}

/** Tell the host to toggle apply-enabled for the current comparison. No-op when no comparison is active. */
export function setApplyEnabled(enabled: boolean): void {
	postEnvelope('compareEnvironments', { type: 'setApplyEnabled', enabled });
}

/** Tell the host to apply all checked entries in the current comparison to the target Vault. */
export function applySelected(): void {
	postEnvelope('compareEnvironments', { type: 'applySelected' });
}

/** Tell the host to discard the current comparison — fired by the selector's "New Compare" control. */
export function clearCompare(): void {
	postEnvelope('compareEnvironments', { type: 'clearCompare' });
}

/**
 * Tell the host the selector has mounted and subscribed, so it replays the state the selector cannot
 * know by itself: the live comparison and the Compare tree's current selection. Without it a selector
 * that mounts over an existing comparison — a re-created webview, or a second surface — would show an
 * empty, unlocked form and sit on its initial "no selection" until the next time the tree changed.
 */
export function signalCompareReady(): void {
	postEnvelope('compareEnvironments', { type: 'ready' });
}

/** Subscribe to selection-changed pushes from the host. Returns an unsubscribe function. */
export function onSelectionChanged(
	callback: (hasSelection: boolean) => void,
): () => void {
	return onEnvelope('compareEnvironments', (raw) => {
		const message = raw as HostToCompareMessage;
		if (message?.type === 'selectionChanged') {
			callback(message.hasSelection);
		}
	});
}

/**
 * Subscribe to the host's reply describing its live comparison (absent when there is none), sent in
 * answer to {@link signalCompareReady}. Returns an unsubscribe function.
 */
export function onSessionState(
	callback: (session: CompareSessionState | undefined) => void,
): () => void {
	return onEnvelope('compareEnvironments', (raw) => {
		const message = raw as HostToCompareMessage;
		if (message?.type === 'sessionState') {
			callback(message.session);
		}
	});
}
