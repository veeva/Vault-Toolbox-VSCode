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

/**
 * Which of VSCode's four theme kinds is active. The names mirror VSCode's own `ColorScheme` enum, so
 * `hcDark` is high contrast *dark* — VSCode spells that body class `vscode-high-contrast`, with no
 * `-dark` suffix, and Monaco calls the same theme `hc-black`.
 */
export type ThemeKind = 'light' | 'dark' | 'hcDark' | 'hcLight';

/**
 * Read the active theme kind off the `<body>` classes VSCode maintains. A high contrast light theme
 * carries `vscode-high-contrast-light` *and* `vscode-high-contrast` (the latter for backwards
 * compatibility), so the more specific class has to be tested first or HC light reads as dark.
 */
export function themeKind(): ThemeKind {
	const { classList } = document.body;
	if (classList.contains('vscode-high-contrast-light')) {
		return 'hcLight';
	}
	if (classList.contains('vscode-high-contrast')) {
		return 'hcDark';
	}
	if (classList.contains('vscode-light')) {
		return 'light';
	}
	return 'dark';
}

export function editorFontFamily(): string {
	const value = getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family');
	return value.trim() || 'monospace';
}

/** Invoke `listener` whenever VSCode switches theme (the `<body>` class changes). Returns a disposer. */
export function onThemeChange(listener: () => void): () => void {
	const observer = new MutationObserver(listener);
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	return () => observer.disconnect();
}
