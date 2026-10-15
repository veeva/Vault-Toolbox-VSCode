import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
// Side-effect import: registers the Cut/Copy/Paste editor actions, context-menu entries, and Command
// Palette items. Note this does NOT bind a Ctrl/Cmd+V *keybinding* — Monaco's own PasteAction
// deliberately skips that outside its native (Electron) shell, expecting the browser to handle paste
// natively ("since browsers do that for us and it avoids security prompts"). A webview's DOM
// clipboard-read permission is unreliable, so we bind paste ourselves below via the host.
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js';
import { requestClipboardText } from '../vqlClient';
import { ResizeHandleIcon } from '../shell/icons';
import {
	ensureMonacoEnvironment,
	editorFontFamily,
	isLightTheme,
	onThemeChange,
} from './monacoEnvironment';
import { registerVqlCompletion } from './vqlCompletion';
import { registerVqlFormatting } from './vqlFormatting';
import {
	registerVqlLanguage,
	VQL_LANGUAGE_ID,
	VQL_THEME_DARK,
	VQL_THEME_LIGHT,
} from './vqlLanguage';

/** Pick the VQL theme from the VSCode body class (VSCode toggles `vscode-light`/`vscode-dark`). */
function currentThemeName(): string {
	return isLightTheme() ? VQL_THEME_LIGHT : VQL_THEME_DARK;
}

interface Props {
	value: string;
	onChange(value: string): void;
	onRun(): void;
}

const EDITOR_LINE_HEIGHT = 19;
/** Vertical padding Monaco reserves above/below the text. */
const EDITOR_VERTICAL_PADDING = 12;
/** Roughly six lines — the height a short query gets, and the floor for an empty editor. */
const MIN_EDITOR_HEIGHT = 120;
/** Cap so a large query grows but never crowds out the Query Builder and results below it. */
const MAX_EDITOR_HEIGHT = 360;

/** Grow the editor with its content (by line count), clamped between a sensible floor and cap. */
function editorHeightForValue(value: string): number {
	const lineCount = value.length === 0 ? 1 : value.split('\n').length;
	const contentHeight = lineCount * EDITOR_LINE_HEIGHT + EDITOR_VERTICAL_PADDING;
	return Math.min(Math.max(contentHeight, MIN_EDITOR_HEIGHT), MAX_EDITOR_HEIGHT);
}

/** Imperative surface for callers that need to drive the editor directly (the Query Builder's write). */
export interface MonacoEditorHandle {
	/**
	 * Replace the entire buffer with `text` as a single undoable edit (recoverable with Ctrl+Z — unlike
	 * `setValue`, which resets the undo stack), then focus the editor with the cursor at end-of-buffer.
	 */
	replaceAllAndFocus(text: string): void;
}

type DragSession = { startY: number; startHeight: number };

/** Monaco-backed VQL editor: VQL highlighting + metadata-driven autocomplete, ⌘/Ctrl+Enter to run. */
export const MonacoEditor = forwardRef<MonacoEditorHandle, Props>(function MonacoEditor(
	{ value, onChange, onRun },
	ref,
): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const onChangeRef = useRef(onChange);
	const onRunRef = useRef(onRun);
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
	const dragState = useRef<DragSession | null>(null);
	const [manualHeight, setManualHeight] = useState<number | null>(null);
	onChangeRef.current = onChange;
	onRunRef.current = onRun;

	// Create the editor once; the latest callbacks are read through refs so this never re-runs.
	useEffect(() => {
		ensureMonacoEnvironment();
		registerVqlLanguage();
		registerVqlCompletion();
		registerVqlFormatting();
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const editor = monaco.editor.create(container, {
			value,
			language: VQL_LANGUAGE_ID,
			theme: currentThemeName(),
			fontFamily: editorFontFamily(),
			automaticLayout: true,
			minimap: { enabled: false },
			lineNumbers: 'off',
			folding: true,
			scrollBeyondLastLine: false,
			renderLineHighlight: 'none',
			overviewRulerLanes: 0,
			wordWrap: 'on',
		});
		editorRef.current = editor;

		const changeSub = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());
		// Bind paste ourselves: Monaco doesn't (see the clipboard.js import note above). Reads the OS
		// clipboard via the extension host and feeds it through Monaco's own "paste" handler, so it
		// behaves exactly like a native paste (respects selection, multi-cursor, etc.).
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
			void requestClipboardText()
				.then((text) => {
					if (text) {
						editor.trigger('keyboard', 'paste', { text, pasteOnNewLine: false });
					}
				})
				.catch(() => {
					// Clipboard read failed or the host didn't respond — leave the editor untouched.
				});
		});

		// Re-theme when VSCode switches light/dark (body class flips).
		const offThemeChange = onThemeChange(() => monaco.editor.setTheme(currentThemeName()));

		return () => {
			offThemeChange();
			changeSub.dispose();
			editor.dispose();
			editorRef.current = undefined;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Reflect programmatic value changes without clobbering the cursor on the user's own edits.
	useEffect(() => {
		const editor = editorRef.current;
		if (editor && editor.getValue() !== value) {
			editor.setValue(value);
		}
	}, [value]);

	useImperativeHandle(ref, () => ({
		replaceAllAndFocus(text: string): void {
			const editor = editorRef.current;
			const model = editor?.getModel();
			if (!editor || !model) {
				return;
			}
			// executeEdits (bracketed by undo stops) replaces the whole buffer as one undoable edit and
			// fires onDidChangeModelContent, so the React `value` stays in sync via onChange.
			editor.pushUndoStop();
			editor.executeEdits('vql-builder', [{ range: model.getFullModelRange(), text }]);
			editor.pushUndoStop();
			const end = model.getFullModelRange().getEndPosition();
			editor.setPosition(end);
			editor.revealPosition(end);
			editor.focus();
		},
	}));

	function onHandleMouseDown(e: React.MouseEvent) {
		e.preventDefault();
		dragState.current = {
			startY: e.clientY,
			startHeight: manualHeight ?? editorHeightForValue(value),
		};

		function onMouseMove(ev: MouseEvent) {
			if (!dragState.current) return;
			const delta = ev.clientY - dragState.current.startY;
			const max = window.innerHeight * 0.5;
			setManualHeight(
				Math.round(Math.min(Math.max(dragState.current.startHeight + delta, MIN_EDITOR_HEIGHT), max)),
			);
		}

		function onMouseUp() {
			dragState.current = null;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		}

		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	const editorHeight = manualHeight ?? editorHeightForValue(value);

	return (
		<div className="vt-monaco-wrapper">
			<div
				ref={containerRef}
				className="vt-monaco"
				style={{ height: `${editorHeight}px` }}
			/>
			<div className="vt-monaco-resize-handle" onMouseDown={onHandleMouseDown}>
				<ResizeHandleIcon />
			</div>
		</div>
	);
});
