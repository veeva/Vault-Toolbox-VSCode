/**
 * One piece of Compare Environments state the host owns and every live shell webview has to mirror —
 * whether anything is checked in the Compare tree, and which comparison is live. Both live on the host
 * side of a boundary the selector can't see across: the tree is a native TreeView, and the selector is
 * a webview whose own React state doesn't survive a rebuild.
 *
 * Fanning out to a listener set, rather than handing the controller a single poster, keeps every
 * surface in sync and lets a surface unsubscribe cleanly when it is disposed — there can be more than
 * one webview alive at a time (the sidebar plus any popped-out panel), and binding to just the newest
 * one silently strands the others.
 *
 * {@link current} is retained so a webview that mounts (or re-mounts) can be replayed what it missed:
 * each push carries the whole value, so the latest one is all a late listener needs. Holds no `vscode`
 * types, matching the rest of the compare state layer.
 */
export class CompareStateBroadcast<T> {
	private readonly listeners = new Set<(value: T) => void>();

	constructor(private value: T) {}

	/** The latest published value — replayed to a webview when it signals it has mounted. */
	get current(): T {
		return this.value;
	}

	/** Publish a new value to every subscribed surface. */
	set(value: T): void {
		this.value = value;
		for (const listener of this.listeners) {
			listener(value);
		}
	}

	/** Subscribe to published values; returns an unsubscribe. */
	onDidChange(listener: (value: T) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
