import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import selectEvent from 'react-select-event';
import { FieldCombobox } from './FieldCombobox';
import type { VaultFieldMeta } from '../../../core/rest/types';

/**
 * The SELECT field combobox uses `VtSelect`'s custom `filterOption`, which matches the typed query
 * against the muted sublabel (`<name> (<type>)`) as well as the visible label. This pins that an API
 * name narrows the list — the regression class where only label-matching worked.
 */
describe('FieldCombobox', () => {
	const fields: readonly VaultFieldMeta[] = [
		{ name: 'name__v', label: 'Name', type: 'String' },
		{ name: 'status__v', label: 'Status', type: 'Picklist' },
		{ name: 'external_id__v', label: 'External Identifier', type: 'String' },
	];

	it('picks a field by its visible label and emits the API name', async () => {
		const onPick = vi.fn();
		render(<FieldCombobox fields={fields} selected={[]} onPick={onPick} onRemove={vi.fn()} />);

		await selectEvent.select(screen.getByLabelText('Fields'), 'Status', {
			container: document.body,
		});

		expect(onPick).toHaveBeenCalledWith('status__v');
	});

	it('filters options by API name via the custom filterOption, not just the label', async () => {
		const user = userEvent.setup();
		render(<FieldCombobox fields={fields} selected={[]} onPick={vi.fn()} onRemove={vi.fn()} />);

		const input = screen.getByLabelText('Fields');
		// "external_id" matches only the sublabel/API name — no field's *label* contains that string.
		await user.type(input, 'external_id');

		const listbox = screen.getByRole('listbox');
		expect(listbox).toHaveTextContent('External Identifier');
		expect(listbox).not.toHaveTextContent('Name');
		expect(listbox).not.toHaveTextContent('Status');
	});
});
