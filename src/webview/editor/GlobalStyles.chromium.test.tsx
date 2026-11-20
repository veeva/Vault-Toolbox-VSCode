import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GlobalStyles } from './GlobalStyles';

/**
 * Real-browser tests for the webview's color scheme, which jsdom can't evaluate: it has no UA
 * default color scheme and no canvas to paint, so a computed `color-scheme` is meaningless there.
 *
 * The defect being guarded: a `color-scheme` on the *root* element makes the webview iframe paint an
 * opaque canvas (#121212 under a dark scheme), which is what put a black background behind a light
 * theme. VSCode relies on the webview staying transparent over the workbench background, so the root
 * must stay `normal` and only `<body>` may carry a scheme.
 */
describe('GlobalStyles color scheme (real browser)', () => {
	afterEach(() => {
		document.body.className = '';
	});

	const kinds = [
		{ name: 'light', bodyClass: 'vscode-light', scheme: 'light' },
		{ name: 'dark', bodyClass: 'vscode-dark', scheme: 'dark' },
		{ name: 'high contrast dark', bodyClass: 'vscode-high-contrast', scheme: 'dark' },
		{
			// VSCode adds `vscode-high-contrast` alongside the light class for backwards compatibility.
			name: 'high contrast light',
			bodyClass: 'vscode-high-contrast-light vscode-high-contrast',
			scheme: 'light',
		},
	];

	for (const { name, bodyClass, scheme } of kinds) {
		it(`applies the ${name} scheme to body`, () => {
			document.body.className = bodyClass;
			render(<GlobalStyles />);
			expect(getComputedStyle(document.body).colorScheme).toBe(scheme);
		});

		it(`leaves the root scheme normal under ${name}`, () => {
			document.body.className = bodyClass;
			render(<GlobalStyles />);
			expect(getComputedStyle(document.documentElement).colorScheme).toBe('normal');
		});
	}
});
