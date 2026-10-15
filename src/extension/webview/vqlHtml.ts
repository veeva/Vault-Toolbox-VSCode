import type { PopOutTab, ShellSurface } from '../../shared/shellProtocol';
import { buildCsp, makeNonce, renderWebviewDocument } from './webviewShell';

/**
 * VQL Editor-specific webview HTML: the Monaco/React-bundle CSP and the body that loads
 * `dist/webview/`. The nonce, CSP assembly, and document scaffold come from the shared
 * `webviewShell`; this file adds only what's specific to the bundled React app. Vscode-free so it's
 * unit-testable without the extension host — the vscode-aware `renderVqlHtml` in `vqlWebviewHost`
 * resolves the webview URIs, then delegates here.
 */

export { makeNonce };

export interface VqlHtmlParams {
	/** Webview URI of the bundled React app (`dist/webview/main.js`). */
	scriptUri: string;
	/** Webview URI of the bundled styles (`dist/webview/main.css`). */
	styleUri: string;
	/** Webview URI of Monaco's base editor worker (`dist/webview/editor.worker.js`). */
	workerUri: string;
	/** Webview URI of Monaco's JSON language worker (`dist/webview/json.worker.js`). */
	jsonWorkerUri: string;
	/** The webview's `cspSource` (the `vscode-webview-resource:` origin its assets load from). */
	cspSource: string;
	/** Per-render nonce gating the inline + bundle `<script>` tags. */
	nonce: string;
	/** Which surface this webview renders as; read by the React shell to pick its tab set. */
	surface: ShellSurface;
	/** For the `panel` surface, which single tab it hosts; read by the React shell to filter to it. */
	panelTab?: PopOutTab;
}

/**
 * Monaco needs extra CSP allowances: `worker-src blob:` for the same-origin blob worker,
 * `${cspSource}` in `script-src` so that worker can `importScripts` the bundled worker resource, and
 * `data:` fonts for the inlined codicon .ttf. See `MonacoEditor.ensureMonacoEnvironment`.
 */
export function buildVqlCsp(cspSource: string, nonce: string): string {
	return buildCsp({
		'style-src': `${cspSource} 'unsafe-inline'`,
		'script-src': `'nonce-${nonce}' ${cspSource}`,
		'worker-src': `blob: ${cspSource}`,
		'font-src': `${cspSource} data:`,
		'img-src': `${cspSource} data:`,
	});
}

export function buildVqlHtml(params: VqlHtmlParams): string {
	const { scriptUri, styleUri, workerUri, jsonWorkerUri, cspSource, nonce, surface, panelTab } = params;
	const tabAttribute = panelTab ? ` data-tab="${panelTab}"` : '';
	return renderWebviewDocument({
		csp: buildVqlCsp(cspSource, nonce),
		title: 'Vault Toolbox',
		head: `<link rel="stylesheet" href="${styleUri}" />`,
		body: `<div id="root" data-surface="${surface}"${tabAttribute}></div>
    <script nonce="${nonce}">window.__vqlEditorWorkerUri = ${JSON.stringify(workerUri)};
    window.__jsonWorkerUri = ${JSON.stringify(jsonWorkerUri)};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>`,
	});
}
