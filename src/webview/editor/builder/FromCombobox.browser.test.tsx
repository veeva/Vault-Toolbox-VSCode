import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import selectEvent from 'react-select-event';
import { FromCombobox } from './FromCombobox';
import type { VaultObjectSummary } from '../../../core/rest/types';

/**
 * Interaction test for the FROM object combobox through the real `VtSelect` (react-select). Direct
 * fireEvent against react-select is fiddly, so `react-select-event` drives it; the menu is portaled
 * to `document.body`, which its queries handle.
 */
describe('FromCombobox', () => {
	const targets: readonly VaultObjectSummary[] = [
		{ name: 'documents', label: 'Documents' },
		{ name: 'product__v', label: 'Product' },
		{ name: 'study__v', label: 'Study' },
	];

	it('opens the menu, picks an option, and emits its target name', async () => {
		const onSelect = vi.fn();
		render(<FromCombobox targets={targets} onSelect={onSelect} />);

		// The menu is portaled to document.body, so point the helper's queries there.
		await selectEvent.select(screen.getByLabelText('Query target'), 'Product', {
			container: document.body,
		});

		// The emitted value is the API `name`, not the visible label.
		expect(onSelect).toHaveBeenCalledWith('product__v');
	});
});
