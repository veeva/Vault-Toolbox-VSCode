import { describe, expect, it } from 'vitest';
import { buildCsp, makeNonce, renderWebviewDocument } from './webviewShell';

describe('buildCsp', () => {
	it('always locks default-src to none', () => {
		expect(buildCsp({})).toBe("default-src 'none'");
	});

	it('appends each directive after default-src, in order', () => {
		expect(buildCsp({ 'style-src': "'nonce-x'", 'script-src': "'nonce-x'" })).toBe(
			"default-src 'none'; style-src 'nonce-x'; script-src 'nonce-x'",
		);
	});
});

describe('renderWebviewDocument', () => {
	it('embeds the CSP, head, and body and defaults the title', () => {
		const html = renderWebviewDocument({
			csp: "default-src 'none'",
			head: `<link rel="stylesheet" href="x.css" />`,
			body: `<div id="root"></div>`,
		});
		expect(html).toContain(`content="default-src 'none'"`);
		expect(html).toContain(`<link rel="stylesheet" href="x.css" />`);
		expect(html).toContain(`<div id="root"></div>`);
		expect(html).toContain('<title>Vault Toolbox</title>');
	});

	it('uses the provided title', () => {
		expect(renderWebviewDocument({ csp: '', body: '' })).toContain('<title>Vault Toolbox</title>');
		expect(renderWebviewDocument({ csp: '', body: '', title: 'Environment' })).toContain(
			'<title>Environment</title>',
		);
	});
});

describe('makeNonce', () => {
	it('produces distinct 32-char hex nonces', () => {
		const a = makeNonce();
		const b = makeNonce();
		expect(a).toMatch(/^[a-f0-9]{32}$/);
		expect(a).not.toBe(b);
	});
});
