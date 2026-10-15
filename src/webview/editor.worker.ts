// Monaco's base editor web worker (EditorSimpleWorker). Bundled by esbuild as a standalone IIFE to
// `dist/webview/editor.worker.js` and loaded by the webview via `MonacoEnvironment.getWorker` (see
// `MonacoEditor.tsx`). Monarch tokenization runs on the main thread, so highlighting works even if
// this worker fails to spawn — the worker only backs ancillary editor features.
import 'monaco-editor/esm/vs/editor/editor.worker.js';
