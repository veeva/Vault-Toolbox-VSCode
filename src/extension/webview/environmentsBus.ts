import type { Environment } from '../../core/models/environment';
import type {
	EnvironmentFormSubmit,
	EnvironmentsToHostMessage,
	HostToEnvironmentsMessage,
} from '../../shared/environmentsProtocol';
import type { ConnectionState } from '../connection/types';
import { buildEnvironmentsSnapshot } from '../environments/environmentsSnapshot';

/** The saved-environment + active-pointer reads the bus needs to build a snapshot. */
export interface EnvironmentReadPort {
	list(): Environment[];
	getActiveId(): string | undefined;
}

/** Per-environment connection state; `ConnectionManager` satisfies it. */
export interface ConnectionStatePort {
	getConnectionState(envId: string): ConnectionState;
}

/**
 * The environment actions, each wrapping the native vscode UX (confirm-on-remove, connect progress,
 * toasts) around `EnvironmentService`. Injected so the bus stays vscode-free; the host supplies the
 * real helpers (shared with the palette commands) and tests supply fakes.
 */
export interface EnvironmentActions {
	connect(id: string): Promise<void>;
	disconnect(id: string): Promise<void>;
	setActive(id: string): Promise<void>;
	remove(id: string): Promise<void>;
	openVault(id: string): Promise<void>;
	submitForm(submit: EnvironmentFormSubmit): Promise<void>;
}

export interface EnvironmentsBusDeps {
	environments: EnvironmentReadPort;
	connection: ConnectionStatePort;
	actions: EnvironmentActions;
	post(message: HostToEnvironmentsMessage): void;
	onReady?(): void;
}

/**
 * Routes Environments-tab webview messages onto the environment actions, and pushes the rendered
 * snapshot back. The vscode-free counterpart to `VqlBus`: all native UX lives in the injected
 * {@link EnvironmentActions}, so the routing + snapshot projection are unit-testable with fakes.
 */
export class EnvironmentsBus {
	constructor(private readonly deps: EnvironmentsBusDeps) {}

	async handle(message: unknown): Promise<void> {
		if (!isValidMessage(message)) {
			// Drop malformed/untrusted input, mirroring VqlBus: the compile-time union is not enforced at
			// runtime, and a buggy or compromised webview must not flow junk into the actions.
			return;
		}
		await this.dispatch(message);
	}

	private async dispatch(message: EnvironmentsToHostMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
				this.pushSnapshot();
				this.deps.onReady?.();
				return;
			case 'connect':
				await this.deps.actions.connect(message.id);
				return;
			case 'disconnect':
				await this.deps.actions.disconnect(message.id);
				return;
			case 'setActive':
				await this.deps.actions.setActive(message.id);
				return;
			case 'remove':
				await this.deps.actions.remove(message.id);
				return;
			case 'openVault':
				await this.deps.actions.openVault(message.id);
				return;
			case 'submitForm':
				await this.deps.actions.submitForm(message);
				return;
			default:
				assertNever(message);
		}
	}

	/** Build the current snapshot and post it to the webview. */
	pushSnapshot(): void {
		const snapshot = buildEnvironmentsSnapshot(
			this.deps.environments.list(),
			this.deps.connection,
			this.deps.environments.getActiveId(),
		);
		this.deps.post({ type: 'snapshot', snapshot });
	}

	/** Reveal + expand the current environment's Vault info. */
	pushReveal(): void {
		this.deps.post({ type: 'reveal' });
	}
}

/** Compile-time guarantee the dispatch switch is exhaustive; a no-op at runtime. */
function assertNever(_message: never): void {
	// unreachable: every EnvironmentsToHostMessage variant is handled above.
}

/**
 * Validate an untrusted webview message at runtime: a known `type` with the fields that variant
 * requires. Anything else is dropped by {@link EnvironmentsBus.handle}.
 */
function isValidMessage(message: unknown): message is EnvironmentsToHostMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}
	const fields = message as Record<string, unknown>;
	const isString = (value: unknown): value is string => typeof value === 'string';
	switch (fields.type) {
		case 'ready':
			return true;
		case 'connect':
		case 'disconnect':
		case 'setActive':
		case 'remove':
		case 'openVault':
			return isString(fields.id);
		case 'submitForm':
			return (
				(fields.mode === 'add' || fields.mode === 'edit') &&
				isString(fields.vaultDNS) &&
				isString(fields.authType) &&
				isString(fields.secret) &&
				(fields.username === undefined || isString(fields.username))
			);
		default:
			return false;
	}
}
