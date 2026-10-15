import type {
	EnvironmentFormSubmit,
	EnvironmentsSnapshot,
	HostToEnvironmentsMessage,
} from '../../shared/environmentsProtocol';
import { onEnvelope, postEnvelope } from '../vscodeApi';

/**
 * Webview half of the Environments bus: sends actions and subscribes to the host-pushed snapshot,
 * all on the `environments` channel of the shell envelope. Unlike the VQL client there's no
 * request/response correlation — the host owns the state and re-pushes a full snapshot on any change.
 */
/** Subscribe to host-pushed environment snapshots. Returns an unsubscribe. */
export function onEnvironmentsSnapshot(
	handler: (snapshot: EnvironmentsSnapshot) => void,
): () => void {
	return onEnvelope('environments', (message) => {
		const hostMessage = message as HostToEnvironmentsMessage;
		if (hostMessage.type === 'snapshot') {
			handler(hostMessage.snapshot);
		}
	});
}

/** Subscribe to a host-pushed reveal (expand the current environment's Vault info). Returns an unsubscribe. */
export function onEnvironmentsReveal(handler: () => void): () => void {
	return onEnvelope('environments', (message) => {
		const hostMessage = message as HostToEnvironmentsMessage;
		if (hostMessage.type === 'reveal') {
			handler();
		}
	});
}

/** Ask the host to push the current snapshot (called once on mount). */
export function requestEnvironments(): void {
	postEnvelope('environments', { type: 'ready' });
}

export function connectEnvironment(id: string): void {
	postEnvelope('environments', { type: 'connect', id });
}

export function disconnectEnvironment(id: string): void {
	postEnvelope('environments', { type: 'disconnect', id });
}

export function setActiveEnvironment(id: string): void {
	postEnvelope('environments', { type: 'setActive', id });
}

export function removeEnvironment(id: string): void {
	postEnvelope('environments', { type: 'remove', id });
}

/** Ask the host to open this environment's Vault in the system browser. */
export function openVaultEnvironment(id: string): void {
	postEnvelope('environments', { type: 'openVault', id });
}

/** Submit the add/edit form; the host validates, persists, and re-pushes the snapshot. */
export function submitEnvironmentForm(submit: EnvironmentFormSubmit): void {
	postEnvelope('environments', { type: 'submitForm', ...submit });
}
