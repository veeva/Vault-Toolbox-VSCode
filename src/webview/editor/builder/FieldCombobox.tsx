import { useMemo } from 'react';
import type { VaultFieldMeta } from '../../../core/rest/types';
import {
	outboundFieldExpression,
	type RelationshipFieldOption,
} from '../../../core/vql/builderPanelState';
import { fieldLabel, fieldSublabel } from './fieldLabels';
import { VtSelect, type VtSelectGroup, type VtSelectOption } from './VtSelect';

interface Props {
	fields: readonly VaultFieldMeta[];
	/** Field `name`s (plain + dotted outbound) already picked into the control — shown as chips and
	 *  excluded from the candidate list. */
	selected: readonly string[];
	/** Relationship-expanded options (outbound + inbound) from `SHOW RELATIONSHIPS`; empty when none. */
	relationshipOptions?: readonly RelationshipFieldOption[];
	/** Whether a relationship option is already picked (an outbound chip / an inbound subquery field). */
	isRelationshipOptionPicked?(option: RelationshipFieldOption): boolean;
	onPick(name: string): void;
	onRemove(name: string): void;
	/** Clear every picked field (plain + outbound dotted) in one shot, wired to the control's clear-all
	 *  `×`. Inbound picks live in their own subquery blocks and aren't affected. */
	onClearAll?(): void;
	onPickRelationship?(option: RelationshipFieldOption): void;
	disabled?: boolean;
}

/** The stable option `value` for a relationship row. Outbound uses the dotted `rel.field` expression —
 *  the exact string stored in the SELECT list — so its chip round-trips through the control. Inbound
 *  uses a distinct prefixed key: it never becomes a chip (it routes to a subquery block), so its value
 *  only needs to be unique and resolvable back to the option on pick. */
function optionValueFor(option: RelationshipFieldOption): string {
	return option.inbound
		? `inbound::${option.relationship}::${option.fieldName}`
		: outboundFieldExpression(option.relationship, option.fieldName);
}

/**
 * Type-ahead `SELECT` field combobox over the loaded `SHOW FIELDS` list, plus grouped **Outbound** and
 * **Inbound** relationship sections from `SHOW RELATIONSHIPS`. Built on the shared {@link VtSelect} as a
 * multi-select: picked base fields and outbound dotted fields render as removable chips **inside** the
 * control (chip order = pick order = SELECT order), while an inbound pick routes to its subquery block
 * (see {@link Props.onPickRelationship}) and never appears as a chip here. Base-field search matches API
 * `name` or `label`; relationship search matches the full row label. Already-picked options drop out of
 * the candidate list so nothing is selected twice.
 */
export function FieldCombobox({
	fields,
	selected,
	relationshipOptions = [],
	isRelationshipOptionPicked,
	onPick,
	onRemove,
	onClearAll,
	onPickRelationship,
	disabled,
}: Props): JSX.Element {
	// Resolve a picked/removed option `value` back to its relationship option (outbound or inbound), so
	// onChange can route it. Base fields aren't in this map — a value absent here is a plain field.
	const relByValue = useMemo(() => {
		const map = new Map<string, RelationshipFieldOption>();
		for (const option of relationshipOptions) {
			map.set(optionValueFor(option), option);
		}
		return map;
	}, [relationshipOptions]);

	// The chips currently in the control: plain fields by their meta label, dotted outbound fields by
	// their relationship row label (falling back to the raw dotted string if relationships aren't loaded).
	const value = useMemo<VtSelectOption[]>(
		() =>
			selected.map((name) => {
				const field = fields.find((candidate) => candidate.name === name);
				if (field) {
					return { value: name, label: fieldLabel(field) };
				}
				const outbound = relByValue.get(name);
				return { value: name, label: outbound?.label ?? name };
			}),
		[selected, fields, relByValue],
	);

	const options = useMemo<VtSelectGroup[]>(() => {
		const groups: VtSelectGroup[] = [];

		const fieldOptions = fields
			.filter((field) => !selected.includes(field.name))
			.map<VtSelectOption>((field) => ({
				value: field.name,
				label: fieldLabel(field),
				sublabel: fieldSublabel(field),
			}));
		if (fieldOptions.length > 0) {
			groups.push({ label: 'Fields', options: fieldOptions });
		}

		const unpicked = relationshipOptions.filter(
			(option) => !(isRelationshipOptionPicked?.(option) ?? false),
		);
		const toOption = (option: RelationshipFieldOption): VtSelectOption => ({
			value: optionValueFor(option),
			label: option.label,
		});
		const outbound = unpicked.filter((option) => !option.inbound).map(toOption);
		const inbound = unpicked.filter((option) => option.inbound).map(toOption);
		if (outbound.length > 0) {
			groups.push({ label: 'Outbound Relationships', options: outbound });
		}
		if (inbound.length > 0) {
			groups.push({ label: 'Inbound Relationships', options: inbound });
		}
		return groups;
	}, [fields, selected, relationshipOptions, isRelationshipOptionPicked]);

	return (
		<VtSelect<true>
			isMulti
			isClearable={value.length > 0}
			closeMenuOnSelect={false}
			inputId="vt-select-input"
			aria-label="Fields"
			placeholder="Select fields…"
			isDisabled={disabled}
			options={options}
			value={value}
			noOptionsMessage={() => 'No matching fields'}
			onChange={(_next, meta) => {
				if (meta.action === 'select-option' && meta.option) {
					const relationship = relByValue.get(meta.option.value);
					if (relationship) {
						onPickRelationship?.(relationship);
					} else {
						onPick(meta.option.value);
					}
				} else if (
					(meta.action === 'remove-value' || meta.action === 'pop-value') &&
					meta.removedValue
				) {
					onRemove(meta.removedValue.value);
				} else if (meta.action === 'clear') {
					onClearAll?.();
				}
			}}
		/>
	);
}
