import type {
	HostToShellMessage,
	PopOutTab,
	ShellSurface,
	ShellTab,
} from '../../shared/shellProtocol';
import { onEnvelope, postEnvelope } from '../vscodeApi';

/**
 * Webview half of the shell control channel: reads which surface this webview is (stamped on the root
 * element by the host), announces readiness, requests pop-out, and subscribes to host-driven
 * navigation + the popped-out state.
 */

/** The surface the host rendered this webview as (defaults to sidebar if unstamped). */
export function getSurface(): ShellSurface {
	return document.getElementById('root')?.getAttribute('data-surface') === 'panel'
		? 'panel'
		: 'sidebar';
}

/** For a `panel` surface, the single tab the host stamped it to host (defaults to the VQL editor). */
export function getPanelTab(): PopOutTab {
	return document.getElementById('root')?.getAttribute('data-tab') === 'apiHistory'
		? 'apiHistory'
		: 'vql';
}

/** Tell the host the shell has mounted (so it can push initial pop-out state / flush navigation). */
export function announceShellReady(): void {
	postEnvelope('shell', { type: 'ready' });
}

/** Ask the host to open (or reveal) the popped-out panel for the given tab. */
export function requestPopOut(tab: PopOutTab): void {
	postEnvelope('shell', { type: 'popOut', tab });
}

/** Ask the host to open the VSCode Settings UI filtered to the Vault Toolbox extension. */
export function requestOpenSettings(): void {
	postEnvelope('shell', { type: 'openSettings' });
}

/** Subscribe to host-driven navigation (switch tab, optionally open the Environments add screen). Returns unsubscribe. */
export function onNavigate(handler: (tab: ShellTab, screen?: 'add') => void): () => void {
	return onEnvelope('shell', (message) => {
		const shellMessage = message as HostToShellMessage;
		if (shellMessage.type === 'navigate') {
			handler(shellMessage.tab, shellMessage.screen);
		}
	});
}

/** Subscribe to whether a poppable tab is currently popped out to an editor tab. Returns unsubscribe. */
export function onPoppedOut(handler: (tab: PopOutTab, poppedOut: boolean) => void): () => void {
	return onEnvelope('shell', (message) => {
		const shellMessage = message as HostToShellMessage;
		if (shellMessage.type === 'poppedOut') {
			handler(shellMessage.tab, shellMessage.value);
		}
	});
}
