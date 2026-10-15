import { describe, it, expect } from 'vitest';
import {
	cellString,
	csvHeaders,
	deriveGridColumns,
	expandedCells,
	isSubqueryValue,
	pageRangeLabel,
	subqueryRowSpan,
	toCsv,
} from './resultGrid';
import type { QueryDescribe } from '../rest/types';

describe('deriveGridColumns', () => {
	it("returns the first row's keys in order, with no subFields for plain columns", () => {
		const cols = deriveGridColumns([
			{ id: 1, name__v: 'A', status__v: 'active' },
			{ id: 2, name__v: 'B', status__v: 'active' },
		]);
		expect(cols).toEqual([{ key: 'id' }, { key: 'name__v' }, { key: 'status__v' }]);
	});

	it('returns no columns for an empty result set', () => {
		expect(deriveGridColumns([])).toEqual([]);
	});

	it("marks a subquery column using queryDescribe, even when this row's subquery is empty", () => {
		const describe: QueryDescribe = {
			subqueries: [
				{ relationship: 'child_object__cr', fields: [{ name: 'id' }, { name: 'name__v' }] },
			],
		};
		const cols = deriveGridColumns(
			[{ id: 1, child_object__cr: { data: [], responseDetails: { total: 0 } } }],
			describe,
		);
		expect(cols).toEqual([
			{ key: 'id' },
			{ key: 'child_object__cr', subFields: ['id', 'name__v'] },
		]);
	});

	it('backfills a selected scalar column that the first row omitted (null field) from queryDescribe.fields', () => {
		const describe: QueryDescribe = {
			fields: [{ name: 'id' }, { name: 'name__v' }, { name: 'external_id__v' }],
		};
		// Vault dropped external_id__v from row 0 because it was null there; it must still get a column.
		const cols = deriveGridColumns(
			[
				{ id: 1, name__v: 'A' },
				{ id: 2, external_id__v: 'X' },
			],
			describe,
		);
		expect(cols).toEqual([{ key: 'id' }, { key: 'name__v' }, { key: 'external_id__v' }]);
	});

	it('backfills a subquery relationship entirely absent from the first row from queryDescribe.subqueries', () => {
		// Reproduces paginating to a later page whose subquery is empty for every row on that page:
		// Vault's response never even carries the relationship key, and this page carries no
		// queryDescribe of its own — callers must reuse the first page's describe (see the function doc).
		const describe: QueryDescribe = {
			subqueries: [
				{ relationship: 'child_object__cr', fields: [{ name: 'id' }, { name: 'name__v' }] },
			],
		};
		const cols = deriveGridColumns([{ id: 1 }], describe);
		expect(cols).toEqual([{ key: 'id' }, { key: 'child_object__cr', subFields: ['id', 'name__v'] }]);
	});

	it('falls back to sniffing the first subquery data row when queryDescribe is unavailable', () => {
		const cols = deriveGridColumns([
			{
				id: 1,
				child_object__cr: { data: [{ id: 2, name__v: 'X' }], responseDetails: { total: 1 } },
			},
		]);
		expect(cols).toEqual([
			{ key: 'id' },
			{ key: 'child_object__cr', subFields: ['id', 'name__v'] },
		]);
	});
});

describe('cellString', () => {
	it('renders an explicit null as the literal "null" and undefined as an empty string', () => {
		expect(cellString(null)).toBe('null');
		expect(cellString(undefined)).toBe('');
	});

	it('renders scalars directly', () => {
		expect(cellString('hello')).toBe('hello');
		expect(cellString(42)).toBe('42');
		expect(cellString(false)).toBe('false');
	});

	it("joins multi-value/picklist arrays with ', ' (recursively)", () => {
		expect(cellString(['a', 'b', 'c'])).toBe('a, b, c');
		expect(cellString([1, ['x', 'y']])).toBe('1, x, y');
	});

	it("falls back to a compact 'N rows' summary for a subquery value (defensive; grid/CSV expand instead)", () => {
		expect(cellString({ data: [{ id: 1 }, { id: 2 }] })).toBe('2 rows');
		expect(cellString({ data: [{ id: 1 }] })).toBe('1 row');
		expect(cellString({ data: [] })).toBe('0 rows');
	});
});

describe('isSubqueryValue', () => {
	it('recognizes an object carrying data or responseDetails', () => {
		expect(isSubqueryValue({ data: [] })).toBe(true);
		expect(isSubqueryValue({ responseDetails: {} })).toBe(true);
	});

	it('rejects scalars, arrays, null, and plain objects without either key', () => {
		expect(isSubqueryValue(null)).toBe(false);
		expect(isSubqueryValue('x')).toBe(false);
		expect(isSubqueryValue(['a', 'b'])).toBe(false);
		expect(isSubqueryValue({ foo: 1 })).toBe(false);
	});
});

describe('subqueryRowSpan', () => {
	it('defaults to 1 for a row with no subqueries', () => {
		expect(subqueryRowSpan({ id: 1, name__v: 'A' })).toBe(1);
	});

	it('returns the largest subquery data length on the row', () => {
		const row = {
			id: 1,
			a__cr: { data: [{}, {}] },
			b__cr: { data: [{}, {}, {}] },
		};
		expect(subqueryRowSpan(row)).toBe(3);
	});

	it('ignores a picklist array (not a subquery) when sizing the span', () => {
		expect(subqueryRowSpan({ id: 1, tags__v: ['a', 'b', 'c'] })).toBe(1);
	});
});

describe('expandedCells', () => {
	it('returns the same single value for a normal column at any rowIndex', () => {
		expect(expandedCells('hello', undefined, 0)).toEqual(['hello']);
		expect(expandedCells('hello', undefined, 2)).toEqual(['hello']);
		expect(expandedCells(['a', 'b'], undefined, 1)).toEqual(['a, b']);
	});

	it("flattens a subquery row's fields at the given index", () => {
		const value = {
			data: [
				{ id: 1, name__v: 'A' },
				{ id: 2, name__v: 'B' },
			],
		};
		expect(expandedCells(value, ['id', 'name__v'], 0)).toEqual(['1', 'A']);
		expect(expandedCells(value, ['id', 'name__v'], 1)).toEqual(['2', 'B']);
	});

	it('blank-pads a subquery column once its data runs out', () => {
		const value = { data: [{ id: 1, name__v: 'A' }] };
		expect(expandedCells(value, ['id', 'name__v'], 1)).toEqual(['', '']);
	});

	it('blank-pads a subquery column with no data at all', () => {
		expect(expandedCells({ data: [] }, ['id', 'name__v'], 0)).toEqual(['', '']);
	});
});

describe('csvHeaders', () => {
	it('dots subquery field names under the relationship key', () => {
		expect(
			csvHeaders([{ key: 'id' }, { key: 'child_object__cr', subFields: ['id', 'name__v'] }]),
		).toEqual(['id', 'child_object__cr.id', 'child_object__cr.name__v']);
	});
});

describe('toCsv', () => {
	it('writes a quoted header row and quoted cells, CRLF-separated', () => {
		const csv = toCsv(
			[{ key: 'id' }, { key: 'name__v' }],
			[
				{ id: '1', name__v: 'Greggs' },
				{ id: '2', name__v: 'Freamon' },
			],
		);
		expect(csv).toBe('"id","name__v"\r\n"1","Greggs"\r\n"2","Freamon"');
	});

	it('escapes embedded quotes, commas, and newlines', () => {
		const csv = toCsv([{ key: 'note' }], [{ note: 'a "quoted", multi\nline' }]);
		expect(csv).toBe('"note"\r\n"a ""quoted"", multi\nline"');
	});

	it('renders missing fields as empty and yields header-only for no rows', () => {
		expect(toCsv([{ key: 'id' }, { key: 'name__v' }], [{ id: '1' }])).toBe(
			'"id","name__v"\r\n"1",""',
		);
		expect(toCsv([{ key: 'id' }], [])).toBe('"id"');
	});

	it('expands a subquery into one CSV row per subquery record, repeating normal fields', () => {
		const csv = toCsv(
			[{ key: 'id' }, { key: 'child_object__cr', subFields: ['id', 'name__v'] }],
			[
				{
					id: '1',
					child_object__cr: {
						data: [
							{ id: 10, name__v: 'X' },
							{ id: 11, name__v: 'Y' },
						],
					},
				},
			],
		);
		expect(csv).toBe(
			'"id","child_object__cr.id","child_object__cr.name__v"\r\n' +
				'"1","10","X"\r\n' +
				'"1","11","Y"',
		);
	});

	it('blank-pads short subqueries so sibling columns stay aligned', () => {
		const csv = toCsv(
			[
				{ key: 'a__cr', subFields: ['id'] },
				{ key: 'b__cr', subFields: ['id'] },
			],
			[
				{
					a__cr: { data: [{ id: 1 }] },
					b__cr: { data: [{ id: 1 }, { id: 2 }] },
				},
			],
		);
		expect(csv).toBe('"a__cr.id","b__cr.id"\r\n"1","1"\r\n"","2"');
	});
});

describe('pageRangeLabel', () => {
	it('labels the first page (0-based offset)', () => {
		expect(pageRangeLabel({ pageoffset: 0, size: 200, total: 4213 })).toBe('1 - 200 / 4213');
	});

	it('labels a later page from its offset', () => {
		expect(pageRangeLabel({ pageoffset: 200, size: 100, total: 4213 })).toBe('201 - 300 / 4213');
	});

	it("collapses an empty page to '0 / N'", () => {
		expect(pageRangeLabel({ pageoffset: 0, size: 0, total: 0 })).toBe('0 / 0');
	});

	it('defaults missing fields to 0', () => {
		expect(pageRangeLabel({})).toBe('0 / 0');
	});
});
