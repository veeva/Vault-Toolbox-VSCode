/**
 * Lexical primitives shared by the VQL formatter and the webview completion provider — the word/
 * boundary predicates both sides of the core↔webview seam were previously reimplementing. Kept
 * vscode-/monaco-free so either side can import them.
 */

/** True when `c` can start a VQL identifier or keyword word. */
export function isWordStart(c: string): boolean {
	return /[A-Za-z_]/.test(c);
}

/** True when `c` can continue a VQL identifier or keyword word. */
export function isWordChar(c: string): boolean {
	return /[A-Za-z0-9_]/.test(c);
}

/** True when position `i` begins a fresh word: start of string, or preceded by a non-word char. */
export function boundaryBefore(s: string, i: number): boolean {
	return i === 0 || !isWordChar(s[i - 1]);
}
