import { useMemo } from 'react';
import type { VaultFieldMeta } from '../../../core/rest/types';
import { fieldLabel, fieldSublabel } from './fieldLabels';
import { VtSelect, type VtSelectOption } from './VtSelect';

interface Props {
	fields: readonly VaultFieldMeta[];
	/** The currently-selected field `name`, if any. */
	value?: string;
	/** Unique per row so the portaled menu's input id stays distinct across rows. */
	inputId: string;
	onSelect(name: string): void;
}

/**
 * Single-select field combobox for a WHERE filter row, over the loaded `SHOW FIELDS` list. Typing
 * filters by API `name` or `label`; the dropdown shows label + name + type and picking a row selects
 * that field. Built on the shared {@link VtSelect}, matching the FROM combobox's look and keyboard
 * behavior. Clearing is intentionally disabled — a filter row always has a field once one is chosen;
 * the row's own `×` removes the whole row.
 */
export function FilterFieldCombobox({ fields, value, inputId, onSelect }: Props): JSX.Element {
	const options = useMemo<VtSelectOption[]>(
		() =>
			fields.map((field) => ({
				value: field.name,
				label: fieldLabel(field),
				sublabel: fieldSublabel(field),
			})),
		[fields],
	);
	const selected = options.find((option) => option.value === value) ?? null;

	return (
		<VtSelect
			inputId={inputId}
			aria-label="Filter field"
			placeholder="Search fields…"
			options={options}
			value={selected}
			onChange={(option) => option && onSelect(option.value)}
		/>
	);
}
