import type { VqlEditorState } from '../../shared/vqlProtocol';

/**
 * Holds the VQL Editor's last-known state in memory so the sidebar view and the popped-out editor
 * tab can reconcile onto the same query/result/view-mode whichever becomes active (see `VqlBus`'s
 * `updateState`/`restoreState` messages). Deliberately not persisted — this is round-trip UI state
 * for the current window session, not a saved artifact like history or saved queries, so it resets
 * on reload.
 */
export class VqlEditorStateStore {
	private state: VqlEditorState | undefined;

	get(): VqlEditorState | undefined {
		return this.state;
	}

	set(state: VqlEditorState): void {
		this.state = state;
	}
}
