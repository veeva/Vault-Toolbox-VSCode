import type { ApiHistoryEntry } from '../../core/rest/apiHistory';
import type {
	ApiHistoryToHostMessage,
	HostToApiHistoryMessage,
} from '../../shared/apiHistoryProtocol';

/** The store the bus reads snapshots from and clears; satisfied by `ApiHistoryStore`. */
export interface ApiHistorySource {
	snapshot(): ApiHistoryEntry[];
	clear(): void;
}

export interface ApiHistoryBusDeps {
	store: ApiHistorySource;
	post(message: HostToApiHistoryMessage): void;
	onReady?(): void;
}

/**
 * Host side of the `apiHistory` channel. Vscode-free (the store + poster are injected) so it's
 * unit-testable. The webview drives it: on `ready` it gets the current snapshot; on `clear` the store
 * is emptied. New entries and clears are pushed proactively via {@link pushEntry}/{@link pushCleared},
 * which the host wires to the store's events.
 */
export class ApiHistoryBus {
	constructor(private readonly deps: ApiHistoryBusDeps) {}

	handle(message: unknown): void {
		if (!isValidMessage(message)) {
			// Drop malformed/untrusted input, mirroring the other buses.
			return;
		}
		if (message.type === 'ready') {
			this.deps.post({ type: 'snapshot', entries: this.deps.store.snapshot() });
			this.deps.onReady?.();
			return;
		}
		this.deps.store.clear();
	}

	pushEntry(entry: ApiHistoryEntry): void {
		this.deps.post({ type: 'entry', entry });
	}

	pushCleared(): void {
		this.deps.post({ type: 'cleared' });
	}

	/** Reveal + expand a specific entry. */
	pushReveal(id: string): void {
		this.deps.post({ type: 'reveal', id });
	}
}

function isValidMessage(message: unknown): message is ApiHistoryToHostMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}
	const { type } = message as Record<string, unknown>;
	return type === 'ready' || type === 'clear';
}
