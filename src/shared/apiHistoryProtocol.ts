/**
 * Typed messages for the `apiHistory` channel bridging the API History webview tab and its host bus.
 * DOM-free and vscode-free so both sides can import it. Bidirectional: the host pushes recorded calls
 * to the webview (snapshot on ready, then one per new call) and the webview requests a snapshot / a clear.
 */
import type { ApiHistoryEntry } from '../core/rest/apiHistory';

export type { ApiHistoryEntry };

/** Host → webview. */
export type HostToApiHistoryMessage =
	| { type: 'snapshot'; entries: ApiHistoryEntry[] }
	| { type: 'entry'; entry: ApiHistoryEntry }
	| { type: 'cleared' }
	| { type: 'reveal'; id: string };

/** Webview → host. */
export type ApiHistoryToHostMessage = { type: 'ready' } | { type: 'clear' };
