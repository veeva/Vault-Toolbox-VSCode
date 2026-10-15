import type {
	CompareKinds,
	CompareRequest,
	CompareSessionState,
	CompareToHostMessage,
	HostToCompareMessage,
} from '../../shared/compareProtocol';
import { AbortSlot } from './abortSlot';

/**
 * The host side of Compare Environments as the webview sees it: the commands the selector issues, plus
 * read access and subscriptions for the two facts the selector can't see for itself — the live
 * comparison and the Compare tree's checkbox state. The host supplies the real (vscode-dependent)
 * implementation.
 */
export interface CompareRunner {
	/**
	 * Compare the source/target pair and kinds chosen in the selector. The signal is aborted when the
	 * user cancels — check it before committing any session state. Returns the result message to post
	 * back, which the bus suppresses if aborted.
	 */
	startCompare(request: CompareRequest, signal: AbortSignal): Promise<HostToCompareMessage>;
	/** Toggle apply-enabled for the current comparison. No-op when no comparison is active. */
	setApplyEnabled(enabled: boolean): void;
	/** Apply all checked entries in the current comparison to the target Vault. */
	applySelected(): void;
	/** Discard the current comparison: close the Vault Compare view and any open diff tabs for it. */
	clearCompare(): void;
	/**
	 * Whether at least one entry is checked in the Compare tree right now — replayed to the selector
	 * when it mounts, since pushes alone would leave a freshly-mounted one showing a stale "no selection".
	 */
	hasSelection(): boolean;
	/** The live comparison the selector should render itself against, or `undefined` when there is none. */
	getSessionState(): CompareSessionState | undefined;
	/**
	 * Subscribe to selection-state changes so the Apply Selected button enables/disables; returns an
	 * unsubscribe. A subscription rather than a single assignable poster, because every live shell
	 * webview needs the push, not just the most recently created one.
	 */
	onSelectionChanged(listener: (hasSelection: boolean) => void): () => void;
	/** Subscribe to comparisons starting and being cleared; returns an unsubscribe. */
	onSessionStateChanged(listener: (session: CompareSessionState | undefined) => void): () => void;
}

export interface CompareBusDeps {
	runner: CompareRunner;
	/** Post a message back to the webview on the compareEnvironments channel. */
	post(message: HostToCompareMessage): void;
}

/**
 * Routes Compare Environments webview messages onto the injected {@link CompareRunner}. Bidirectional:
 * the webview sends the start/cancel requests and the host posts the compare result back. Holds one
 * {@link AbortController} for the in-flight compare so `cancelCompare` can abort it before its result is
 * committed or posted. Vscode-free (the runner + poster are injected) so it's unit-testable.
 */
export class CompareBus {
	private readonly compareSlot = new AbortSlot();

	constructor(private readonly deps: CompareBusDeps) {}

	async handle(message: unknown): Promise<void> {
		if (!isValidMessage(message)) {
			// Drop malformed/untrusted input, mirroring the other buses: the compile-time union is not
			// enforced at runtime, and a buggy or compromised webview must not flow junk into the runner.
			return;
		}
		await this.dispatch(message);
	}

	private async dispatch(message: CompareToHostMessage): Promise<void> {
		switch (message.type) {
			case 'startCompare': {
				const { sourceId, targetId, kinds } = message;
				await this.compareSlot.run(
					(signal) => this.deps.runner.startCompare({ sourceId, targetId, kinds }, signal),
					this.deps.post,
				);
				return;
			}
			case 'cancelCompare':
				this.compareSlot.abort();
				return;
			case 'setApplyEnabled':
				this.deps.runner.setApplyEnabled(message.enabled);
				return;
			case 'applySelected':
				this.deps.runner.applySelected();
				return;
			case 'clearCompare':
				this.deps.runner.clearCompare();
				return;
			case 'ready':
				// The selector just mounted and subscribed. Replay the whole cross-boundary state it can't
				// know by itself: the live comparison (none of which survives a webview rebuild) and the
				// tree's current selection, which it would otherwise learn only on the next change.
				//
				// Deliberately *not* routed through shellHost's `whenReady` gate, unlike the vql,
				// environments and apiHistory channels. That gate buffers host pushes until its webview
				// mounts the matching tab — but Compare has no popped-out panel, so a panel surface never
				// mounts this tab and never sends `ready`, and anything buffered for it would queue
				// forever. Replaying on `ready` covers the same race without the unbounded queue: both
				// pushes carry whole state, so a push dropped before mount is superseded by this reply.
				this.deps.post({ type: 'sessionState', session: this.deps.runner.getSessionState() });
				this.deps.post({ type: 'selectionChanged', hasSelection: this.deps.runner.hasSelection() });
				return;
			default:
				assertNever(message);
		}
	}
}

/** Compile-time guarantee the dispatch switch is exhaustive; a no-op at runtime. */
function assertNever(_message: never): void {
	// unreachable: every CompareToHostMessage variant is handled above.
}

/**
 * Validate an untrusted `startCompare` `kinds` payload: both flags must be booleans and at least one
 * must be set — a comparison that fetches nothing is meaningless, so the host drops it (the selector
 * also disables Compare in that state).
 */
function isCompareKinds(value: unknown): value is CompareKinds {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const kinds = value as Record<string, unknown>;
	return typeof kinds.mdl === 'boolean' && typeof kinds.code === 'boolean' && (kinds.mdl || kinds.code);
}

/**
 * Validate an untrusted webview message at runtime: a known `type` with the fields that variant
 * requires. Anything else is dropped by {@link CompareBus.handle}.
 */
function isValidMessage(message: unknown): message is CompareToHostMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}
	const fields = message as Record<string, unknown>;
	switch (fields.type) {
		case 'startCompare':
			return (
				typeof fields.sourceId === 'string' &&
				typeof fields.targetId === 'string' &&
				isCompareKinds(fields.kinds)
			);
		case 'cancelCompare':
			return true;
		case 'setApplyEnabled':
			return typeof fields.enabled === 'boolean';
		case 'applySelected':
			return true;
		case 'clearCompare':
			return true;
		case 'ready':
			return true;
		default:
			return false;
	}
}
