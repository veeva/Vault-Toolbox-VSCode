import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { monacoEditorStubModule } from '../test/monacoEditorStub';
import { QueryEditor } from './QueryEditor';
import type { MonacoEditorHandle } from './MonacoEditor';

// jsdom cannot boot real Monaco; swap in the textarea stub honoring the same Props/Handle.
vi.mock('./MonacoEditor', () => monacoEditorStubModule());

/**
 * Renders `QueryEditor` in jsdom via the Monaco stub — proving the stub honors the editor's contract
 * (value in, onChange/onRun out, `replaceAllAndFocus` on the handle) so component tests of anything
 * that embeds the editor stay possible without a real browser.
 */
describe('QueryEditor (jsdom, Monaco stubbed)', () => {
	it('renders the current value and reports edits via onChange', async () => {
		const onChange = vi.fn();
		render(<QueryEditor value="SELECT id" onChange={onChange} onRun={vi.fn()} onFormat={vi.fn()} onSave={vi.fn()} />);

		const editor = screen.getByLabelText('VQL editor');
		expect(editor).toHaveValue('SELECT id');
		await userEvent.type(editor, ' FROM documents');
		expect(onChange).toHaveBeenCalled();
	});

	it('fires onRun on ⌘/Ctrl+Enter', async () => {
		const onRun = vi.fn();
		render(<QueryEditor value="SELECT id FROM documents" onChange={vi.fn()} onRun={onRun} onFormat={vi.fn()} onSave={vi.fn()} />);

		screen.getByLabelText('VQL editor').focus();
		await userEvent.keyboard('{Control>}{Enter}{/Control}');
		expect(onRun).toHaveBeenCalledTimes(1);
	});

	it('drives the buffer through the imperative handle (replaceAllAndFocus)', () => {
		const ref = createRef<MonacoEditorHandle>();
		const onChange = vi.fn();
		render(<QueryEditor ref={ref} value="" onChange={onChange} onRun={vi.fn()} onFormat={vi.fn()} onSave={vi.fn()} />);

		ref.current?.replaceAllAndFocus('SELECT name__v FROM documents');
		expect(onChange).toHaveBeenCalledWith('SELECT name__v FROM documents');
	});
});
