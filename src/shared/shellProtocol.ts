/**
 * The unified sidebar webview multiplexes every feature's traffic over one `postMessage` channel.
 * Each message is wrapped in an envelope tagging which feature it belongs to, so the host-side
 * `ShellRouter` can dispatch it to that feature's bus without knowing the inner message shape.
 * Kept vscode-free and DOM-free so both the host and the webview can import it.
 */

/** The feature channels carried over the single webview transport. */
export type Channel =
	| 'vql'
	| 'environments'
	| 'shell'
	| 'actions'
	| 'apiHistory'
	| 'compareEnvironments';

/** A channel-tagged wrapper around a feature's own (opaque, here) message. */
export interface ShellEnvelope {
	channel: Channel;
	message: unknown;
}

/** Which surface a webview instance renders as: the always-on sidebar, or the popped-out panel. */
export type ShellSurface = 'sidebar' | 'panel';

/** The shell's top-level feature tabs. */
export type ShellTab = 'environments' | 'vql' | 'compareEnvironments' | 'actions' | 'apiHistory';

/** The tabs that can be popped out into a full-width editor panel. */
export type PopOutTab = Extract<ShellTab, 'vql' | 'apiHistory'>;

/** Every poppable tab, so the host can iterate them (e.g. to push each one's popped-out state). */
export const POP_OUT_TAB_IDS: PopOutTab[] = ['vql', 'apiHistory'];

/** Shell channel: webview → host. */
export type ShellToHostMessage =
	{ type: 'ready' } | { type: 'popOut'; tab: PopOutTab } | { type: 'openSettings' };

/** Shell channel: host → webview. */
export type HostToShellMessage =
	| { type: 'navigate'; tab: ShellTab; screen?: 'add' }
	| { type: 'poppedOut'; tab: PopOutTab; value: boolean };
