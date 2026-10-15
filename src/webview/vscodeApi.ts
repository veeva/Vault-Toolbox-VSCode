import type { Channel, ShellEnvelope } from '../shared/shellProtocol';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/vqlProtocol';

/** The slice of the VS Code webview API we use: enveloped messaging + persisted view state. */
interface VsCodeApi {
	postMessage(envelope: ShellEnvelope): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * `acquireVsCodeApi` may be called only once per webview load, so we cache it. The unified sidebar
 * webview multiplexes every feature over this one channel, so all traffic is wrapped in a
 * {@link ShellEnvelope} tagging its {@link Channel}; the host-side `ShellRouter` unwraps and
 * dispatches. `getState`/`setState` persist small UI state (e.g. the active tab) across reloads.
 */
const api = acquireVsCodeApi();

/** Post a bare feature message to the host, wrapped in its channel envelope. */
export function postEnvelope(channel: Channel, message: unknown): void {
	api.postMessage({ channel, message });
}

/** Subscribe to inbound messages on one channel (host envelopes filtered by channel). */
export function onEnvelope(channel: Channel, handler: (message: unknown) => void): () => void {
	const listener = (event: MessageEvent<ShellEnvelope>): void => {
		const envelope = event.data;
		if (envelope && envelope.channel === channel) {
			handler(envelope.message);
		}
	};
	window.addEventListener('message', listener);
	return () => window.removeEventListener('message', listener);
}

/** VQL-channel post (host → `VqlBus`). The VQL client stays channel-agnostic. */
export function postToHost(message: WebviewToHostMessage): void {
	postEnvelope('vql', message);
}

/** Subscribe to VQL-channel host messages. */
export function onHostMessage(handler: (message: HostToWebviewMessage) => void): () => void {
	return onEnvelope('vql', (message) => handler(message as HostToWebviewMessage));
}

/** Read the persisted webview UI state (undefined before anything is stored). */
export function getWebviewState<T>(): T | undefined {
	return api.getState() as T | undefined;
}

/** Persist webview UI state, replacing any prior value. */
export function setWebviewState<T>(state: T): void {
	api.setState(state);
}
