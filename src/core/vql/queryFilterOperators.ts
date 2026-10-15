/**
 * The single source of truth for which VQL filter operators a field can take, keyed by field type.
 * The WHERE builder and autocomplete derive their per-row operator menus from here, so neither ever
 * offers an operator a field type can't accept. Mirrors the SPEC's "Operators per field type" table.
 * Kept vscode-/monaco-free and DOM-free so both the host and the webview import it without drifting apart.
 *
 * The rows encode three deliberate consequences: there is no `BETWEEN` (express a range as two
 * `>=`/`<=` rows) and no `is null` operator; `LIKE` is offered only on text-shaped types (String,
 * Object/ID, Default); and `Date` accepts neither `CONTAINS` nor `LIKE` while `DateTime` accepts
 * `CONTAINS`. Each row is already in the exact order the operator menu renders.
 *
 * Field-type strings are Vault's `SHOW FIELDS` / queryDescribe `type` tokens (e.g. `String`,
 * `DateTime`, `Picklist`, `ObjectReference`). The SPEC groups some Vault types under one row:
 * `Currency` is a Number subtype (Vault reports it as `type: Number`), so it folds into `Number`;
 * and every object-shaped token (`Object`, `ObjectReference`, `ObjectParent`, `Parent`, `ID`) folds
 * into `Object`. Matching is case-insensitive and whitespace-tolerant. Any queryable type not named
 * in the SPEC table (`LongText`, `RichText`, `Component`, `Lookup`, `Formula`, ...) resolves to
 * `Default`, the most permissive (superset) row, so an unrecognized type is never over-restricted.
 */

/** A VQL comparison operator the WHERE builder can place in a filter row. */
export type FilterOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'CONTAINS' | 'LIKE';

/** The field-type rows of {@link supportedQueryFilterOperators} (SPEC row labels, not raw Vault tokens). */
export type QueryFilterFieldType =
	| 'String'
	| 'Number'
	| 'Date'
	| 'DateTime'
	| 'Boolean'
	| 'Picklist'
	| 'Object'
	| 'Default';

/** Field-type row → its ordered, valid filter operators. Order is the menu render order. */
export const supportedQueryFilterOperators: Readonly<
	Record<QueryFilterFieldType, readonly FilterOperator[]>
> = {
	String: ['=', '!=', 'LIKE', 'CONTAINS'],
	Number: ['=', '!=', '<', '>', '<=', '>=', 'CONTAINS'],
	Date: ['=', '!=', '<', '>', '<=', '>='],
	DateTime: ['=', '!=', '<', '>', '<=', '>=', 'CONTAINS'],
	Boolean: ['=', '!='],
	Picklist: ['=', '!=', 'CONTAINS'],
	Object: ['=', '!=', 'LIKE', 'CONTAINS'],
	Default: ['=', '!=', '<', '>', '<=', '>=', 'CONTAINS', 'LIKE'],
};

/**
 * Lowercased Vault `type` token → SPEC row. Only the tokens the SPEC table names appear here; any
 * token absent from this map resolves to `Default` (see {@link resolveFilterFieldType}).
 */
const fieldTypeTokenToRow: ReadonlyMap<string, QueryFilterFieldType> = new Map([
	['string', 'String'],
	['number', 'Number'],
	['currency', 'Number'],
	['date', 'Date'],
	['datetime', 'DateTime'],
	['boolean', 'Boolean'],
	['picklist', 'Picklist'],
	['object', 'Object'],
	['objectreference', 'Object'],
	['objectparent', 'Object'],
	['parent', 'Object'],
	['id', 'Object'],
]);

/**
 * Resolve a Vault field-`type` token to its SPEC row (see {@link supportedQueryFilterOperators}). An
 * unknown or missing token resolves to `Default`. Matching is case-insensitive and trims surrounding
 * whitespace. Shared by the operator lookup and by value quoting (which quotes text-shaped rows).
 */
export function resolveFilterFieldType(fieldType: string | undefined): QueryFilterFieldType {
	return fieldType
		? (fieldTypeTokenToRow.get(fieldType.trim().toLowerCase()) ?? 'Default')
		: 'Default';
}

/**
 * The ordered list of filter operators valid for a Vault field type. An unknown or missing type
 * resolves to the `Default` row. Matching is case-insensitive and trims surrounding whitespace.
 */
export function operatorsForFieldType(fieldType: string | undefined): readonly FilterOperator[] {
	return supportedQueryFilterOperators[resolveFilterFieldType(fieldType)];
}
