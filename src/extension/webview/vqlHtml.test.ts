import { describe, expect, it } from 'vitest';
import { buildVqlCsp, buildVqlHtml, makeNonce } from './vqlHtml';

const PARAMS = {
	scriptUri: 'https://webview/main.js',
	styleUri: 'https://webview/main.css',
	workerUri: 'https://webview/editor.worker.js',
	jsonWorkerUri: 'https://webview/json.worker.js',
	cspSource: 'vscode-webview://csp',
	nonce: 'TESTNONCE',
	surface: 'sidebar' as const,
};

describe('buildVqlCsp', () => {
	it('locks default-src to none and gates scripts on the nonce', () => {
		const csp = buildVqlCsp(PARAMS.cspSource, PARAMS.nonce);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain(`script-src 'nonce-${PARAMS.nonce}' ${PARAMS.cspSource}`);
	});

	it("grants Monaco's worker + inlined-font allowances", () => {
		const csp = buildVqlCsp(PARAMS.cspSource, PARAMS.nonce);
		expect(csp).toContain(`worker-src blob: ${PARAMS.cspSource}`);
		expect(csp).toContain(`font-src ${PARAMS.cspSource} data:`);
	});
});

describe('buildVqlHtml', () => {
	it('references all bundled assets, including both Monaco workers', () => {
		const html = buildVqlHtml(PARAMS);
		expect(html).toContain(`href="${PARAMS.styleUri}"`);
		expect(html).toContain(`src="${PARAMS.scriptUri}"`);
		expect(html).toContain(`window.__vqlEditorWorkerUri = ${JSON.stringify(PARAMS.workerUri)}`);
		expect(html).toContain(`window.__jsonWorkerUri = ${JSON.stringify(PARAMS.jsonWorkerUri)}`);
	});

	it('nonces both script tags and embeds the CSP', () => {
		const html = buildVqlHtml(PARAMS);
		const nonced = html.match(new RegExp(`nonce="${PARAMS.nonce}"`, 'g')) ?? [];
		expect(nonced).toHaveLength(2);
		expect(html).toContain(
			`content="default-src 'none'; style-src vscode-webview://csp 'unsafe-inline'; ` +
				`script-src 'nonce-TESTNONCE' vscode-webview://csp; worker-src blob: vscode-webview://csp; ` +
				`font-src vscode-webview://csp data:; img-src vscode-webview://csp data:"`,
		);
		expect(html).toContain('<div id="root" data-surface="sidebar"></div>');
	});

	it('stamps the surface onto the root element so the shell can pick its tab set', () => {
		expect(buildVqlHtml({ ...PARAMS, surface: 'panel' })).toContain(
			'<div id="root" data-surface="panel"></div>',
		);
	});
});

describe('makeNonce', () => {
	it('is re-exported from webviewShell for callers of vqlHtml', () => {
		// Behavior is covered by webviewShell.test.ts; here we only assert the re-export exists.
		expect(typeof makeNonce()).toBe('string');
	});
});
