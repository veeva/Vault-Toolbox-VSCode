import type { VaultFieldMeta } from '../../../core/rest/types';

/** A field's primary combobox label: its human `label`, falling back to the API `name`. */
export function fieldLabel(field: VaultFieldMeta): string {
	return field.label ?? field.name;
}

/** A field's secondary combobox line: `<name> (<type>)`, or just the name when the type is unknown. */
export function fieldSublabel(field: VaultFieldMeta): string {
	return field.type ? `${field.name} (${field.type})` : field.name;
}
