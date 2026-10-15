import type { QueryDescribe, QueryResponseDetails, QueryRow, SubqueryValue } from '../rest/types';

/**
 * Framework-agnostic helpers for turning VQL result rows into a flat grid. Kept vscode-free so the
 * same logic serves the webview grid and CSV export. Subquery rows are expanded (row-span in the
 * grid, extra CSV rows on export).
 */

export interface GridColumn {
	key: string;
	/** Field names of a nested subquery relationship, in Vault's order; absent for a normal column. */
	subFields?: string[];
}

/**
 * Column list for the grid/CSV: one entry per field name of the first row, in Vault's order, then any selected scalar field that the first row omitted appended in `queryDescribe.fields`
 * order. Vault drops null fields from a row's JSON, so a field that is null on the first row would
 * otherwise get no column; `queryDescribe.fields` lists every selected scalar field, so we backfill
 * the missing ones (they render empty for null rows). The same backfill applies to subquery
 * relationships named in `queryDescribe.subqueries`: a relationship with no data on the first row
 * (e.g. paginating to a page where it's empty for every row) is otherwise absent from that row's keys
 * entirely. A column is a subquery column when `queryDescribe.subqueries` names it (preferred — stays
 * correct even when this page's first row has no subquery data), falling back to sniffing the first
 * row's value when `describe` is unavailable. Empty when there are no rows; callers show an empty-state.
 *
 * Vault only returns `queryDescribe` on a query's first page — callers paginating through a result set
 * must keep passing that first page's `describe` on every subsequent page, since a query's columns
 * can't legitimately change page-to-page (see `ResultGrid`'s `describe` prop).
 */
export function deriveGridColumns(
	data: ReadonlyArray<QueryRow>,
	describe?: QueryDescribe,
): GridColumn[] {
	if (data.length === 0) {
		return [];
	}
	const firstRow = data[0];
	const keys = Object.keys(firstRow);
	for (const field of describe?.fields ?? []) {
		if (!keys.includes(field.name)) {
			keys.push(field.name);
		}
	}
	for (const subquery of describe?.subqueries ?? []) {
		const key = subquery.relationship ?? subquery.alias;
		if (key && !keys.includes(key)) {
			keys.push(key);
		}
	}
	return keys.map((key) => {
		const subFields = subqueryFieldNames(key, describe, firstRow[key]);
		return subFields ? { key, subFields } : { key };
	});
}

function findSubqueryDescribe(key: string, describe: QueryDescribe | undefined) {
	return describe?.subqueries?.find(
		(subquery) => subquery.relationship === key || subquery.alias === key,
	);
}

function subqueryFieldNames(
	key: string,
	describe: QueryDescribe | undefined,
	sampleValue: unknown,
): string[] | undefined {
	const described = findSubqueryDescribe(key, describe);
	if (described) {
		return described.fields.map((field) => field.name);
	}
	if (isSubqueryValue(sampleValue)) {
		const firstSubRow = sampleValue.data?.[0];
		return firstSubRow ? Object.keys(firstSubRow) : [];
	}
	return undefined;
}

/**
 * Flatten a scalar or multi-value/picklist array to a display string. Recurses into arrays. An
 * explicit `null` field value renders as the literal "null" (distinguishing a returned null from a
 * blank cell), while `undefined` — an absent key, e.g. a backfilled column on a row that omitted the
 * field, or a subquery-alignment blank — renders as an empty string. A subquery value reaching here
 * (rather than through `expandedCells`, which is what the grid/CSV use) falls back to a compact
 * "N rows" summary so it never renders as "[object Object]".
 */
export function cellString(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.map(cellString).join(', ');
	}
	if (isSubqueryValue(value)) {
		const count = value.data?.length ?? 0;
		return `${count} ${count === 1 ? 'row' : 'rows'}`;
	}
	return String(value);
}

/**
 * A nested subquery result arrives as an object carrying `data` and/or `responseDetails` (Vault's
 * raw, snake_case field names — this value passes through unparsed).
 */
export function isSubqueryValue(value: unknown): value is SubqueryValue {
	return (
		typeof value === 'object' && value !== null && ('data' in value || 'responseDetails' in value)
	);
}

/**
 * How many stacked rows a record's subqueries need: the largest subquery `data` length on the row,
 * or 1 when the row has none. Fed a grid-page row, this reflects only that page's first subquery page;
 * fed a fully-paginated row (CSV export resolves every subquery page first), it reflects the true total 
 * — same formula, since both just count whatever is actually in `data`.
 */
export function subqueryRowSpan(row: QueryRow): number {
	let max = 1;
	for (const value of Object.values(row)) {
		if (isSubqueryValue(value) && Array.isArray(value.data) && value.data.length > max) {
			max = value.data.length;
		}
	}
	return max;
}

/**
 * Cell text for one column at one expansion row-index. A normal column always returns its single
 * value regardless of `rowIndex` (the grid rowSpans it across the expansion rows; CSV repeats it on
 * each expanded line). A subquery column returns that subquery's `rowIndex`-th
 * record flattened across `subFields`, or blanks once the subquery runs out of rows — so column
 * alignment holds even when sibling subqueries have different lengths.
 */
export function expandedCells(
	value: unknown,
	subFields: string[] | undefined,
	rowIndex: number,
): string[] {
	if (!subFields) {
		return [cellString(value)];
	}
	if (isSubqueryValue(value) && Array.isArray(value.data) && rowIndex < value.data.length) {
		const subRow = value.data[rowIndex] as QueryRow;
		return subFields.map((field) => cellString(subRow[field]));
	}
	return subFields.map(() => '');
}

/**
 * Human-readable range label for the current page, e.g. `"1 - 200 / 4213"`. `pageoffset`
 * is 0-based; `size` is the row count on this page. An empty page collapses to `"0 / N"`. Fields
 * default to 0 when Vault omits them.
 */
export function pageRangeLabel(details: QueryResponseDetails): string {
	const total = details.total ?? 0;
	const offset = details.pageoffset ?? 0;
	const size = details.size ?? 0;
	if (size === 0) {
		return `0 / ${total}`;
	}
	return `${offset + 1} - ${offset + size} / ${total}`;
}

/** Flat CSV header names: `relationship.field` for each subquery column's fields, else the column key. */
export function csvHeaders(columns: ReadonlyArray<GridColumn>): string[] {
	return columns.flatMap((column) =>
		column.subFields ? column.subFields.map((field) => `${column.key}.${field}`) : [column.key],
	);
}

/**
 * Serialize result rows to CSV text (RFC-4180 style): CRLF line breaks, every field double-quote
 * wrapped with `"` escaped as `""`. A row with subqueries expands into `subqueryRowSpan(row)` CSV
 * lines — one per subquery record, normal fields repeated on each. Headers are dotted per subquery 
 * field (`csvHeaders`). Callers must fully paginate each row's subqueries first 
 * (see `VqlBus.resolveSubqueryPages`) so `total`, not just the first page, is exported. 
 * The header row is always emitted; an empty `rows` yields it alone.
 */
export function toCsv(columns: ReadonlyArray<GridColumn>, rows: ReadonlyArray<QueryRow>): string {
	const lines: string[] = [csvHeaders(columns).map(csvField).join(',')];
	for (const row of rows) {
		const span = subqueryRowSpan(row);
		for (let expansionRowIndex = 0; expansionRowIndex < span; expansionRowIndex++) {
			const cells = columns.flatMap((column) =>
				expandedCells(row[column.key], column.subFields, expansionRowIndex),
			);
			lines.push(cells.map(csvField).join(','));
		}
	}
	return lines.join('\r\n');
}

/** Quote a single CSV field, doubling any embedded quotes. */
function csvField(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}
