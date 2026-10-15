declare global {
	interface Window {
		/** Webview-resource URI of the bundled base `editor.worker.js`, injected by the host HTML. */
		__vqlEditorWorkerUri?: string;
		/** Webview-resource URI of the bundled `json.worker.js` (Monaco's JSON language service). */
		__jsonWorkerUri?: string;
	}
}

/**
 * Under the webview's strict CSP a cross-origin `new Worker(resourceUri)` is blocked (workers must be
 * same-origin), so we spawn a same-origin **blob** worker that `importScripts` the bundled worker's
 * resource URL. This needs CSP `worker-src blob:` + `script-src <cspSource>` (see `vqlHtml`).
 */
function spawnBlobWorker(scriptUri: string | undefined): Worker {
	const shim = `importScripts(${JSON.stringify(scriptUri)});`;
	const blob = new Blob([shim], { type: 'text/javascript' });
	return new Worker(URL.createObjectURL(blob));
}

/**
 * Set the Monaco worker factory once, before any editor is created. Monaco asks for a worker by
 * language `label` — the JSON language service wants its own `json.worker`; everything else uses the
 * base editor worker.
 */
export function ensureMonacoEnvironment(): void {
	const globalScope = self as unknown as { MonacoEnvironment?: unknown };
	if (globalScope.MonacoEnvironment) {
		return;
	}
	globalScope.MonacoEnvironment = {
		getWorker(_workerId: string, label: string): Worker {
			if (label === 'json') {
				return spawnBlobWorker(window.__jsonWorkerUri);
			}
			return spawnBlobWorker(window.__vqlEditorWorkerUri);
		},
	};
}

/** True when VSCode is in a light theme (it toggles `vscode-light`/`vscode-dark` on `<body>`). */
export function isLightTheme(): boolean {
	return document.body.classList.contains('vscode-light');
}

export function editorFontFamily(): string {
	const value = getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family');
	return value.trim() || 'monospace';
}

/** Invoke `listener` whenever VSCode flips light/dark (the `<body>` class changes). Returns a disposer. */
export function onThemeChange(listener: () => void): () => void {
	const observer = new MutationObserver(listener);
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	return () => observer.disconnect();
}
