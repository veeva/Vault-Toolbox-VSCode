import { randomBytes } from 'node:crypto';

/**
 * The skeleton shared by every extension webview: the per-render nonce, the CSP builder, and the
 * `<!DOCTYPE html>` document scaffold. Both the VQL Editor (a bundled React app — see `vqlHtml`) and
 * the Environment form (inline HTML) render through this, so the nonce/CSP/document policy lives in
 * one tested place rather than being copy-pasted per surface. Vscode-free so it's unit-testable
 * without the extension host.
 */

/**
 * Build a `Content-Security-Policy` value from a directive map. `default-src 'none'` is always
 * prepended, so every webview starts locked down and opens only what it names.
 */
export function buildCsp(directives: Record<string, string>): string {
	return [
		`default-src 'none'`,
		...Object.entries(directives).map(([directive, value]) => `${directive} ${value}`),
	].join('; ');
}

export interface WebviewDocument {
	/** The `Content-Security-Policy` value; build it with {@link buildCsp}. */
	csp: string;
	/** Markup for the document `<body>` (root div + scripts, or an inline form + script). */
	body: string;
	/** Extra `<head>` markup — a stylesheet `<link>`, an inline `<style>`, etc. */
	head?: string;
	/** Document title. */
	title?: string;
}

/** Render the shared document shell around a body and optional head extras. */
export function renderWebviewDocument(doc: WebviewDocument): string {
	const { csp, body, head = '', title = 'Vault Toolbox' } = doc;
	return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${head}
    <title>${title}</title>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

/**
 * A per-render nonce gating a webview's inline + bundle `<script>`/`<style>` tags. Uses a
 * cryptographically-secure source — a predictable nonce would weaken the CSP's XSS protection.
 */
export function makeNonce(): string {
	return randomBytes(16).toString('hex');
}
