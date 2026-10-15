import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import {
	ensureMonacoEnvironment,
	editorFontFamily,
	isLightTheme,
	onThemeChange,
} from './monacoEnvironment';
import { JSON_LANGUAGE_ID } from './jsonMode';

/**
 * Space count for `JSON.stringify` when formatting values for this viewer. The viewer folds by
 * indentation (see `foldingStrategy` below), so every caller must pretty-print with this width for
 * fold ranges to line up — hence one shared constant rather than a literal at each call site.
 */
export const JSON_INDENT = 4;

/** In `fit` mode, grow to fit content but cap so a huge payload scrolls instead of taking the page. */
const MAX_FIT_HEIGHT = 360;
const MIN_FIT_HEIGHT = 40;

/**
 * `fit` sizes the viewer to its content (capped) — for the API History card, where it sits inline.
 * `fill` makes it flex to fill its parent — for the VQL results panel, which owns the scroll area.
 */
type Sizing = 'fit' | 'fill';

/** Native Monaco theme names, so JSON colors match VS Code's Light+/Dark+ exactly. */
function jsonThemeName(): string {
	return isLightTheme() ? 'vs' : 'vs-dark';
}

/** A read-only Monaco editor for JSON: VS Code's own highlighting + folding, no validation squiggles. */
export function ReadOnlyJsonViewer({
	value,
	sizing = 'fit',
}: {
	value: string;
	sizing?: Sizing;
}): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();

	useEffect(() => {
		ensureMonacoEnvironment();
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const editor = monaco.editor.create(container, {
			value,
			language: JSON_LANGUAGE_ID,
			theme: jsonThemeName(),
			fontFamily: editorFontFamily(),
			readOnly: true,
			domReadOnly: true,
			automaticLayout: true,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			renderLineHighlight: 'none',
			overviewRulerLanes: 0,
			wordWrap: 'on',
			folding: true,
			// Fold from indentation on the main thread. The JSON language service's own fold provider
			// runs in a web worker that doesn't deliver ranges here, so `'auto'` yields no folding;
			// our values are always pretty-printed, so indentation folding is exact and worker-free.
			foldingStrategy: 'indentation',
			contextmenu: false,
			// Let the page scroll once the viewer is at its capped height rather than trapping the wheel.
			scrollbar: { alwaysConsumeMouseWheel: false },
		});
		editorRef.current = editor;

		// `fill` lets the parent's flex layout drive height; only `fit` measures content.
		const fitToContent = (): void => {
			if (sizing !== 'fit') {
				return;
			}
			const fitted = Math.min(MAX_FIT_HEIGHT, Math.max(MIN_FIT_HEIGHT, editor.getContentHeight()));
			container.style.height = `${fitted}px`;
			editor.layout();
		};
		fitToContent();
		const sizeSub = editor.onDidContentSizeChange(fitToContent);
		const offThemeChange = onThemeChange(() => monaco.editor.setTheme(jsonThemeName()));

		return () => {
			sizeSub.dispose();
			offThemeChange();
			editor.dispose();
			editorRef.current = undefined;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const editor = editorRef.current;
		if (editor && editor.getValue() !== value) {
			editor.setValue(value);
		}
	}, [value]);

	return (
		<div ref={containerRef} className={`vt-json-viewer${sizing === 'fill' ? ' is-fill' : ''}`} />
	);
}
