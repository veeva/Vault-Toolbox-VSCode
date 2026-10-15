import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { MonacoEditor } from '../MonacoEditor';
import { FromCombobox } from './FromCombobox';

/**
 * Portal-stacking test — the reason `VtSelect` portals its menu to `document.body` with a very high
 * z-index (VtSelect.tsx:60) is so the dropdown renders *above* Monaco's own high stacking layers.
 * jsdom has no layout, so this can only be verified in a real browser.
 */
describe('VtSelect portal stacking (real browser)', () => {
	it('renders its menu above the Monaco editor', async () => {
		const { container, getByLabelText } = render(
			<div>
				<FromCombobox
					targets={[
						{ name: 'documents', label: 'Documents' },
						{ name: 'product__v', label: 'Product' },
					]}
					onSelect={() => {}}
				/>
				<MonacoEditor value="SELECT id FROM documents" onChange={() => {}} onRun={() => {}} />
			</div>,
		);

		// Open the menu.
		await userEvent.click(getByLabelText('Query target'));

		// The portalled menu is the last-painted, so a point inside its bounds hit-tests to a node
		// inside the menu — not to the Monaco editor beneath it.
		const menu = document.body.querySelector('.vt-rs__menu');
		expect(menu).not.toBeNull();
		const rect = menu!.getBoundingClientRect();
		const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		expect(menu!.contains(topElement)).toBe(true);
		expect(container.querySelector('.monaco-editor')?.contains(topElement)).toBeFalsy();
	});
});
