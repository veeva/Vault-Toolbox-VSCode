import { describe, it, expect } from 'vitest';
import {
	supportedQueryFilterOperators,
	operatorsForFieldType,
	resolveFilterFieldType,
	type FilterOperator,
} from './queryFilterOperators';

describe('supportedQueryFilterOperators map', () => {
	it('String → = != LIKE CONTAINS', () => {
		expect(supportedQueryFilterOperators.String).toEqual(['=', '!=', 'LIKE', 'CONTAINS']);
	});

	it('Number → = != < > <= >= CONTAINS', () => {
		expect(supportedQueryFilterOperators.Number).toEqual(['=', '!=', '<', '>', '<=', '>=', 'CONTAINS']);
	});

	it('Date → = != < > <= >=', () => {
		expect(supportedQueryFilterOperators.Date).toEqual(['=', '!=', '<', '>', '<=', '>=']);
	});

	it('DateTime → = != < > <= >= CONTAINS', () => {
		expect(supportedQueryFilterOperators.DateTime).toEqual(['=', '!=', '<', '>', '<=', '>=', 'CONTAINS']);
	});

	it('Boolean → = !=', () => {
		expect(supportedQueryFilterOperators.Boolean).toEqual(['=', '!=']);
	});

	it('Picklist → = != CONTAINS', () => {
		expect(supportedQueryFilterOperators.Picklist).toEqual(['=', '!=', 'CONTAINS']);
	});

	it('Object → = != LIKE CONTAINS', () => {
		expect(supportedQueryFilterOperators.Object).toEqual(['=', '!=', 'LIKE', 'CONTAINS']);
	});

	it('Default → = != < > <= >= CONTAINS LIKE', () => {
		expect(supportedQueryFilterOperators.Default).toEqual(['=', '!=', '<', '>', '<=', '>=', 'CONTAINS', 'LIKE']);
	});
});

describe('operatorsForFieldType lookup', () => {
	it('resolves each SPEC row by its Vault type token', () => {
		expect(operatorsForFieldType('String')).toEqual(supportedQueryFilterOperators.String);
		expect(operatorsForFieldType('Number')).toEqual(supportedQueryFilterOperators.Number);
		expect(operatorsForFieldType('Date')).toEqual(supportedQueryFilterOperators.Date);
		expect(operatorsForFieldType('DateTime')).toEqual(supportedQueryFilterOperators.DateTime);
		expect(operatorsForFieldType('Boolean')).toEqual(supportedQueryFilterOperators.Boolean);
		expect(operatorsForFieldType('Picklist')).toEqual(supportedQueryFilterOperators.Picklist);
	});

	it('folds Currency into the Number row (Currency is a Number subtype in Vault)', () => {
		expect(operatorsForFieldType('Currency')).toEqual(supportedQueryFilterOperators.Number);
	});

	it('folds ID and every object-reference token into the Object row', () => {
		expect(operatorsForFieldType('Object')).toEqual(supportedQueryFilterOperators.Object);
		expect(operatorsForFieldType('ID')).toEqual(supportedQueryFilterOperators.Object);
		expect(operatorsForFieldType('ObjectReference')).toEqual(supportedQueryFilterOperators.Object);
		expect(operatorsForFieldType('ObjectParent')).toEqual(supportedQueryFilterOperators.Object);
		expect(operatorsForFieldType('Parent')).toEqual(supportedQueryFilterOperators.Object);
	});

	it('matches field-type tokens case-insensitively and trims surrounding whitespace', () => {
		expect(operatorsForFieldType('datetime')).toEqual(supportedQueryFilterOperators.DateTime);
		expect(operatorsForFieldType('OBJECTREFERENCE')).toEqual(supportedQueryFilterOperators.Object);
		expect(operatorsForFieldType('  Picklist  ')).toEqual(supportedQueryFilterOperators.Picklist);
	});

	it('falls back to the Default row for an unknown type', () => {
		expect(operatorsForFieldType('LongText')).toEqual(supportedQueryFilterOperators.Default);
		expect(operatorsForFieldType('SomethingNew')).toEqual(supportedQueryFilterOperators.Default);
	});

	it('falls back to the Default row for a missing type', () => {
		expect(operatorsForFieldType(undefined)).toEqual(supportedQueryFilterOperators.Default);
		expect(operatorsForFieldType('')).toEqual(supportedQueryFilterOperators.Default);
	});
});

describe('resolveFilterFieldType', () => {
	it('resolves each SPEC row by its Vault type token', () => {
		expect(resolveFilterFieldType('String')).toBe('String');
		expect(resolveFilterFieldType('Boolean')).toBe('Boolean');
		expect(resolveFilterFieldType('Picklist')).toBe('Picklist');
	});

	it('folds Currency into Number and every object-reference token into Object', () => {
		expect(resolveFilterFieldType('Currency')).toBe('Number');
		expect(resolveFilterFieldType('ID')).toBe('Object');
		expect(resolveFilterFieldType('ObjectReference')).toBe('Object');
	});

	it('is case- and whitespace-insensitive', () => {
		expect(resolveFilterFieldType('  datetime ')).toBe('DateTime');
	});

	it('falls back to Default for unknown or missing tokens', () => {
		expect(resolveFilterFieldType('LongText')).toBe('Default');
		expect(resolveFilterFieldType(undefined)).toBe('Default');
		expect(resolveFilterFieldType('')).toBe('Default');
	});
});

describe('operator-map consequences (ported from the SPEC table)', () => {
	const allRows = Object.values(supportedQueryFilterOperators);

	it('never offers BETWEEN', () => {
		for (const operators of allRows) {
			expect(operators).not.toContain('BETWEEN' as FilterOperator);
		}
	});

	it('never offers an is-null operator', () => {
		for (const operators of allRows) {
			expect(operators).not.toContain('IS NULL' as FilterOperator);
			expect(operators).not.toContain('null' as FilterOperator);
		}
	});

	it('offers LIKE only on String, Object, and Default', () => {
		const rowsWithLike = Object.entries(supportedQueryFilterOperators)
			.filter(([, operators]) => operators.includes('LIKE'))
			.map(([type]) => type);
		expect(rowsWithLike.sort()).toEqual(['Default', 'Object', 'String']);
	});

	it('gives Date neither CONTAINS nor LIKE, but gives DateTime CONTAINS', () => {
		expect(supportedQueryFilterOperators.Date).not.toContain('CONTAINS');
		expect(supportedQueryFilterOperators.Date).not.toContain('LIKE');
		expect(supportedQueryFilterOperators.DateTime).toContain('CONTAINS');
		expect(supportedQueryFilterOperators.DateTime).not.toContain('LIKE');
	});
});
