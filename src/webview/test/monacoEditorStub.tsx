import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { MonacoEditorHandle } from '../editor/MonacoEditor';

/**
 * A `<textarea>` stand-in for `MonacoEditor`, for the jsdom tier — real Monaco needs canvas /
 * `DOMMatrix` / `matchMedia` that jsdom lacks, so booting it there is a known dead end (see spec).
 * The stub honors the same `Props` (`value`/`onChange`/`onRun`) and `MonacoEditorHandle`
 * (`replaceAllAndFocus`), so any component that renders `MonacoEditor` can be exercised in jsdom.
 *
 * ⌘/Ctrl+Enter fires `onRun` (mirrors the real editor's Run keybinding). Use via:
 *   `vi.mock('./MonacoEditor', () => monacoEditorStubModule());`
 */
interface StubProps {
	value: string;
	onChange(value: string): void;
	onRun(): void;
}

export const MonacoEditorStub = forwardRef<MonacoEditorHandle, StubProps>(function MonacoEditorStub(
	{ value, onChange, onRun },
	ref,
): JSX.Element {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	useImperativeHandle(ref, () => ({
		replaceAllAndFocus(text: string): void {
			onChange(text);
			textareaRef.current?.focus();
		},
	}));
	return (
		<textarea
			ref={textareaRef}
			aria-label="VQL editor"
			value={value}
			onChange={(event) => onChange(event.target.value)}
			onKeyDown={(event) => {
				if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
					event.preventDefault();
					onRun();
				}
			}}
		/>
	);
});

/** The module shape `vi.mock('./MonacoEditor', () => monacoEditorStubModule())` should return. */
export function monacoEditorStubModule(): { MonacoEditor: typeof MonacoEditorStub } {
	return { MonacoEditor: MonacoEditorStub };
}
