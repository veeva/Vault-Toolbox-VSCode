import { useMemo } from 'react';
import type { VaultPicklistValue } from '../../../core/rest/types';
import {
	type FilterOperator,
	type QueryFilterFieldType,
	resolveFilterFieldType,
} from '../../../core/vql/queryFilterOperators';
import { VtSelect, type VtSelectOption } from './VtSelect';

interface Props {
	/** The row's raw Vault `type` token — decides which widget renders (see {@link resolveFilterFieldType}). */
	fieldType?: string;
	operator?: FilterOperator;
	/** The single-value operator's value; ignored while `operator` is `CONTAINS`. */
	value: string;
	/** The `CONTAINS` list entries; ignored while `operator` is a single-value operator. */
	values: readonly string[];
	/** True when the field is a picklist (detected via the picklist index, not the Vault type token):
	 *  the value widget becomes a dropdown showing each value's `label` and writing its `name`. */
	isPicklist?: boolean;
	/** The picklist's values (name + label); `undefined` while still loading. Only read when
	 *  {@link isPicklist} is true. An empty array means the picklist genuinely has no values. */
	picklistValues?: readonly VaultPicklistValue[];
	onValueChange(value: string): void;
	onValuesChange(values: string[]): void;
}

/** The HTML input type a scalar (non-picklist, non-boolean) row edits its value with. */
type ScalarWidget = 'text' | 'number' | 'date';

/** VQL requires a full UTC DateTime literal (`YYYY-MM-DDTHH:MM:SS.SSSZ`), which a native
 *  `datetime-local` picker can't produce, so DateTime uses a plain text input hinting this format. */
const DATETIME_PLACEHOLDER = 'YYYY-MM-DDTHH:MM:SS.000Z (e.g. 2026-09-24T12:39:00.000Z)';

function scalarWidget(fieldType: QueryFilterFieldType): ScalarWidget {
	switch (fieldType) {
		case 'Number':
			return 'number';
		case 'Date':
			return 'date';
		default:
			return 'text';
	}
}

/** The `<input>` placeholder: a `%` hint under `LIKE`, the UTC format hint for DateTime, else generic. */
function placeholderFor(fieldType: QueryFilterFieldType, operator?: FilterOperator): string {
	if (operator === 'LIKE') {
		return 'value (use % wildcard)';
	}
	if (fieldType === 'DateTime') {
		return DATETIME_PLACEHOLDER;
	}
	return 'value';
}

const BOOLEAN_OPTIONS: VtSelectOption[] = [
	{ value: 'true', label: 'true' },
	{ value: 'false', label: 'false' },
];

/**
 * The value side of a WHERE filter row, rendering the widget that matches the field's type. Picklist
 * and Boolean fields use the themed {@link VtSelect}: a single-value dropdown, or (under `CONTAINS`) a
 * multi-select whose chips live in the control. A free-text `CONTAINS` uses a creatable multi-select —
 * type a value and press Enter to add it as a chip. Number / Date / plain-text single values keep a
 * native `<input>` (a picker/spinner react-select can't better), with a `%` hint under `LIKE`. DateTime
 * uses a plain text input with a format hint, since a `datetime-local` picker can't emit the full
 * `YYYY-MM-DDTHH:MM:SS.000Z` UTC literal VQL requires.
 */
export function FilterValueEditor({
	fieldType,
	operator,
	value,
	values,
	isPicklist,
	picklistValues,
	onValueChange,
	onValuesChange,
}: Props): JSX.Element {
	const isContains = operator === 'CONTAINS';

	if (isPicklist) {
		return (
			<PicklistValueEditor
				loading={!picklistValues}
				options={picklistValues ?? []}
				isContains={isContains}
				value={value}
				values={values}
				onValueChange={onValueChange}
				onValuesChange={onValuesChange}
			/>
		);
	}

	if (isContains) {
		return <ContainsCreatableEditor values={values} onValuesChange={onValuesChange} />;
	}

	if (resolveFilterFieldType(fieldType) === 'Boolean') {
		const selected = BOOLEAN_OPTIONS.find((option) => option.value === value) ?? null;
		return (
			<VtSelect
				aria-label="Filter value"
				placeholder="Choose…"
				isClearable
				options={BOOLEAN_OPTIONS}
				value={selected}
				onChange={(option) => onValueChange(option?.value ?? '')}
			/>
		);
	}

	const resolvedType = resolveFilterFieldType(fieldType);
	const widget = scalarWidget(resolvedType);
	return (
		<input
			type={widget}
			className="vt-builder-value"
			aria-label="Filter value"
			placeholder={placeholderFor(resolvedType, operator)}
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
		/>
	);
}

interface PicklistProps {
	loading: boolean;
	options: readonly VaultPicklistValue[];
	isContains: boolean;
	value: string;
	values: readonly string[];
	onValueChange(value: string): void;
	onValuesChange(values: string[]): void;
}

/** Picklist value editor: single dropdown, or a multi-select under `CONTAINS`. Each option shows the
 *  value `label` but stores its `name` (what the built VQL writes). */
function PicklistValueEditor({
	loading,
	options,
	isContains,
	value,
	values,
	onValueChange,
	onValuesChange,
}: PicklistProps): JSX.Element {
	const selectOptions = useMemo<VtSelectOption[]>(
		() => options.map((option) => ({ value: option.name, label: option.label ?? option.name })),
		[options],
	);

	if (isContains) {
		const picked = values
			.map((name) => selectOptions.find((option) => option.value === name))
			.filter((option): option is VtSelectOption => option !== undefined);
		return (
			<VtSelect<true>
				isMulti
				isLoading={loading}
				aria-label="Filter values"
				placeholder={loading ? 'Loading values…' : 'Add value…'}
				options={selectOptions}
				value={picked}
				onChange={(next) => onValuesChange(next.map((option) => option.value))}
			/>
		);
	}

	const selected = selectOptions.find((option) => option.value === value) ?? null;
	return (
		<VtSelect
			isLoading={loading}
			isClearable
			aria-label="Filter value"
			placeholder={loading ? 'Loading values…' : 'Choose…'}
			options={selectOptions}
			value={selected}
			onChange={(option) => onValueChange(option?.value ?? '')}
		/>
	);
}

interface ContainsProps {
	values: readonly string[];
	onValuesChange(values: string[]): void;
}

/** Free-text `CONTAINS` editor: a creatable multi-select where the user types a value and presses
 *  Enter to drop it in as a removable chip, generating `field CONTAINS (v1, v2, …)`. */
function ContainsCreatableEditor({ values, onValuesChange }: ContainsProps): JSX.Element {
	const value = useMemo<VtSelectOption[]>(
		() => values.map((entry) => ({ value: entry, label: entry })),
		[values],
	);
	return (
		<VtSelect<true>
			isMulti
			isCreatable
			aria-label="Filter values"
			placeholder="Type a value and press Enter…"
			options={[]}
			value={value}
			formatCreateLabel={(input) => `Add: ${input}`}
			noOptionsMessage={() => 'Type a value and press Enter…'}
			onChange={(next) => onValuesChange(next.map((option) => option.value))}
		/>
	);
}
