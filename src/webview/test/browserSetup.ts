import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { installVsCodeApiStub } from './vsCodeApiStub';

/**
 * Setup for the opt-in real-browser (chromium) tier. Two jobs:
 *
 * 1. Install the same `acquireVsCodeApi` shim the jsdom tier uses, before any webview module loads —
 *    `MonacoEditor` transitively imports `vqlClient`, which calls it at module load.
 * 2. Point Monaco at a real Vite-bundled worker. Product code spawns a *blob* worker importing a
 *    host-injected resource URI (webview CSP), which doesn't exist under Vite; `ensureMonacoEnvironment`
 *    early-returns when `MonacoEnvironment` is already set, so setting it here wins.
 */

installVsCodeApiStub();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
	getWorker(): Worker {
		return new EditorWorker();
	},
};
