import { useMemo } from 'react';
import type { VaultObjectSummary } from '../../../core/rest/types';
import { VtSelect, type VtSelectOption } from './VtSelect';

interface Props {
	targets: readonly VaultObjectSummary[];
	/** The currently-selected target `name`, if any. */
	value?: string;
	onSelect(name: string): void;
	disabled?: boolean;
}

function targetLabel(target: VaultObjectSummary): string {
	return target.label ?? target.name;
}

/**
 * Searchable `FROM` query-target combobox over the pre-warmed `SHOW TARGETS` list. Typing filters by
 * API `name` or label; the dropdown shows label + name and picking a row selects that target. Built on
 * the shared {@link VtSelect} (react-select), so keyboard navigation, clearing, and portaled menus come
 * for free. Clearing the selection reports the empty string, which the parent treats as "no target picked".
 */
export function FromCombobox({ targets, value, onSelect, disabled }: Props): JSX.Element {
	const options = useMemo<VtSelectOption[]>(
		() =>
			targets.map((target) => ({
				value: target.name,
				label: targetLabel(target),
				sublabel: target.name,
			})),
		[targets],
	);
	const selected = options.find((option) => option.value === value) ?? null;

	return (
		<VtSelect
			inputId="vt-from-input"
			aria-label="Query target"
			placeholder="Select a query target…"
			isClearable
			isDisabled={disabled}
			options={options}
			value={selected}
			onChange={(option) => onSelect(option?.value ?? '')}
		/>
	);
}
