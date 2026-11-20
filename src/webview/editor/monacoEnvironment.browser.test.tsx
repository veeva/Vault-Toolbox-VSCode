import { afterEach, describe, expect, it } from 'vitest';
import { themeKind } from './monacoEnvironment';

/**
 * `themeKind` reads the `<body>` classes VSCode maintains. The case that matters is high contrast
 * light: VSCode adds `vscode-high-contrast` alongside `vscode-high-contrast-light` for backwards
 * compatibility, so a naive check reports it as dark and the editor themes against the wrong kind.
 */
describe('themeKind', () => {
	afterEach(() => {
		document.body.className = '';
	});

	it('reads a light theme', () => {
		document.body.className = 'vscode-light';
		expect(themeKind()).toBe('light');
	});

	it('reads a dark theme', () => {
		document.body.className = 'vscode-dark';
		expect(themeKind()).toBe('dark');
	});

	it('reads a high contrast dark theme', () => {
		document.body.className = 'vscode-high-contrast';
		expect(themeKind()).toBe('hcDark');
	});

	it('reads high contrast light as light despite the compatibility class', () => {
		document.body.className = 'vscode-high-contrast-light vscode-high-contrast';
		expect(themeKind()).toBe('hcLight');
	});

	it('falls back to dark before VSCode has applied a theme class', () => {
		expect(themeKind()).toBe('dark');
	});
});
