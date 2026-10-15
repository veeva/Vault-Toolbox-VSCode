import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { MonacoEditor, type MonacoEditorHandle } from './MonacoEditor';

/**
 * Real-browser tests for the things jsdom can't do: booting Monaco (canvas/DOMMatrix), its Run
 * keybinding, and the imperative buffer write. Runs only under `npm run test:browser`.
 */
describe('MonacoEditor (real browser)', () => {
	it('mounts, fires onRun on ⌘/Ctrl+Enter, and syncs the buffer via replaceAllAndFocus', async () => {
		const onRun = vi.fn();
		const onChange = vi.fn();
		const ref = createRef<MonacoEditorHandle>();
		const { container } = render(
			<MonacoEditor ref={ref} value="SELECT id FROM documents" onChange={onChange} onRun={onRun} />,
		);

		// The editor mounts and its hidden input area is created.
		let textarea: HTMLTextAreaElement | null = null;
		await vi.waitFor(
			() => {
				expect(container.querySelector('.monaco-editor')).not.toBeNull();
				textarea = container.querySelector<HTMLTextAreaElement>('textarea');
				expect(textarea).not.toBeNull();
			},
			{ timeout: 5000 },
		);

		// Focus the editor's textarea and press the Run chord. Monaco's `CtrlCmd` modifier resolves to
		// Meta on macOS and Control elsewhere, so press the platform-appropriate one.
		textarea!.focus();
		const runModifier = navigator.platform.toLowerCase().includes('mac') ? 'Meta' : 'Control';
		await userEvent.keyboard(`{${runModifier}>}{Enter}{/${runModifier}}`);
		await vi.waitFor(() => {
			expect(onRun).toHaveBeenCalled();
		});

		// A programmatic buffer replacement fires onChange with the new text (single undoable edit).
		onChange.mockClear();
		ref.current!.replaceAllAndFocus('SELECT name__v FROM documents');
		await vi.waitFor(() => {
			expect(onChange).toHaveBeenCalledWith('SELECT name__v FROM documents');
		});
	});
});
