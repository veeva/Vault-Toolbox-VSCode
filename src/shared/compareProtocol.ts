/**
 * Typed messages for the `compareEnvironments` channel bridging the Compare Environments selector and
 * its host bus. DOM-free and vscode-free so both sides can import it. Bidirectional: the webview starts
 * or cancels a comparison, and the host posts the outcome back so the selector can show a loading state,
 * dismiss on success, or surface a failure inline.
 */

/**
 * Which kinds a Compare Environments run should fetch and diff: **Components (MDL)** and/or **Code
 * (Vault Java SDK)**. Both toggles default on in the selector; at least one must be set (the selector
 * disables Compare otherwise, and the host guards it too).
 */
export interface CompareKinds {
	mdl: boolean;
	code: boolean;
}

/** The source/target pair and kinds that define a single Compare Environments run. */
export interface CompareRequest {
	sourceId: string;
	targetId: string;
	kinds: CompareKinds;
}

/**
 * Compare channel: webview → host. `startCompare` carries the source/target pair and kinds chosen in
 * the selector so the host runs the comparison directly; `cancelCompare` aborts the in-flight run;
 * `setApplyEnabled` toggles the apply-enabled gate for the current comparison; `clearCompare` discards
 * the current comparison (fired by the selector's "New Compare" control) so the source/target/kinds
 * controls can be used again. `ready` announces that the selector has mounted and subscribed, so the
 * host replays the state it holds on the far side of the boundary — the live comparison and the current
 * tree selection — which the selector would otherwise learn only when one of them next changed.
 */
export type CompareToHostMessage =
	| ({ type: 'startCompare' } & CompareRequest)
	| { type: 'cancelCompare' }
	| { type: 'setApplyEnabled'; enabled: boolean }
	| { type: 'applySelected' }
	| { type: 'clearCompare' }
	| { type: 'ready' };

/**
 * The host's live comparison, as much of it as the selector needs to render itself: which pair it ran
 * for, which kinds it fetched, and whether apply is enabled on it. Sent in reply to `ready` so a
 * selector that mounts over an existing comparison — after a window reload, or a webview rebuilt when
 * the view is relocated — shows the comparison it is attached to rather than an empty, unlocked form.
 * `targetIsProduction` is deliberately absent: the selector derives it from its Environments snapshot,
 * so it stays honest about the *current* target rather than the one captured at comparison time.
 */
export interface CompareSessionState extends CompareRequest {
	applyEnabled: boolean;
}

/**
 * Compare channel: host → webview. Reports the outcome of a Compare Environments request so the selector
 * can show a loading state while the host works, then either dismiss on success or surface a failure
 * inline without leaving the screen. `selectionChanged` mirrors the native Compare tree's checkbox state
 * into the selector, which gates the **Apply Selected to Target** button on it; it carries the whole
 * state, so the latest message is always sufficient on its own. `sessionState` carries the live
 * comparison (absent when there is none): it answers `ready`, rehydrating a freshly-mounted selector,
 * and is pushed whenever a comparison starts or is cleared, so a selector that mounted mid-run doesn't
 * stay empty once the run lands.
 */
export type HostToCompareMessage =
	| { type: 'compareResult'; status: 'success' }
	| { type: 'compareResult'; status: 'error'; errorMessage: string }
	| { type: 'selectionChanged'; hasSelection: boolean }
	| { type: 'sessionState'; session?: CompareSessionState };
