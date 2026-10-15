import { describe, it, expect } from 'vitest';
import {
	CLAUSE_KEYWORDS,
	OPERATOR_KEYWORDS,
	VQL_CLAUSE_KEYWORDS,
	VQL_DATE_LITERAL_DOCS,
	VQL_DATE_LITERALS,
	VQL_FUNCTION_DOCS,
	VQL_FUNCTIONS,
	VQL_KEYWORDS,
	VQL_OPERATOR_KEYWORDS,
	VQL_OPTION_DOCS,
	VQL_OPTIONS,
} from './vqlKeywords';

describe('vqlKeywords', () => {
	it('exposes clause and operator keywords lower-cased for the formatter', () => {
		expect(CLAUSE_KEYWORDS.has('select')).toBe(true);
		expect(CLAUSE_KEYWORDS.has('from')).toBe(true);
		expect(OPERATOR_KEYWORDS.has('like')).toBe(true);
	});

	it('omits the non-existent IS operator (VQL tests null with `= null`)', () => {
		expect(OPERATOR_KEYWORDS.has('is')).toBe(false);
		expect(VQL_KEYWORDS).not.toContain('IS');
		expect(VQL_OPERATOR_KEYWORDS).not.toContain('IS');
	});

	it('exposes the Monaco keyword set upper-cased with no duplicates', () => {
		expect(VQL_KEYWORDS).toContain('SELECT');
		expect(VQL_KEYWORDS.every((k) => k === k.toUpperCase())).toBe(true);
		expect(new Set(VQL_KEYWORDS).size).toBe(VQL_KEYWORDS.length);
	});

	it('derives the highlight set from the same words the formatter uppercases (no drift)', () => {
		for (const clause of CLAUSE_KEYWORDS) {
			expect(VQL_KEYWORDS).toContain(clause.toUpperCase());
		}
		for (const operator of OPERATOR_KEYWORDS) {
			expect(VQL_KEYWORDS).toContain(operator.toUpperCase());
		}
	});

	it('splits the Monaco highlight set into clause/operator categories that partition VQL_KEYWORDS', () => {
		expect(VQL_CLAUSE_KEYWORDS).toContain('SELECT');
		expect(VQL_CLAUSE_KEYWORDS).toContain('GROUP');
		expect(VQL_CLAUSE_KEYWORDS).toContain('BY');
		expect(VQL_CLAUSE_KEYWORDS).toContain('RANK');
		expect(VQL_CLAUSE_KEYWORDS).toContain('PAGEOFFSET');
		expect(VQL_CLAUSE_KEYWORDS).toContain('FIELDS');
		expect(VQL_OPERATOR_KEYWORDS).toContain('AND');
		expect(VQL_OPERATOR_KEYWORDS).toContain('LIKE');

		const categorized = [...VQL_CLAUSE_KEYWORDS, ...VQL_OPERATOR_KEYWORDS];
		expect(new Set(categorized)).toEqual(new Set(VQL_KEYWORDS));
		expect(categorized.length).toBe(VQL_KEYWORDS.length);
	});

	it("groups SCOPE with functions/options rather than clause/operator keywords, matching the docs' Functions & Options reference", () => {
		expect(VQL_OPTIONS).toContain('SCOPE');
		expect(VQL_KEYWORDS).not.toContain('SCOPE');
	});

	it('keeps functions, options, and date literals disjoint from keywords', () => {
		const keywords = new Set(VQL_KEYWORDS);
		for (const symbol of [...VQL_FUNCTIONS, ...VQL_OPTIONS, ...VQL_DATE_LITERALS]) {
			expect(keywords.has(symbol)).toBe(false);
		}
	});

	it('derives the function/option name arrays from their doc maps (no drift)', () => {
		expect(VQL_FUNCTIONS).toEqual(Object.keys(VQL_FUNCTION_DOCS));
		expect(VQL_OPTIONS).toEqual(Object.keys(VQL_OPTION_DOCS));
		expect(VQL_FUNCTIONS).toContain('TONAME');
		expect(VQL_FUNCTIONS).toContain('FILENAME');
	});

	it('exposes all 16 relative date literals; only single-current-period ones take no :n count', () => {
		expect(VQL_DATE_LITERALS).toEqual(Object.keys(VQL_DATE_LITERAL_DOCS));
		expect(VQL_DATE_LITERALS).toHaveLength(16);
		expect(VQL_DATE_LITERALS).toContain('TODAY');
		expect(VQL_DATE_LITERALS).toContain('DAYS_AGO');
		const noCount = ['TODAY', 'THIS_MONTH', 'THIS_QUARTER', 'THIS_YEAR'];
		for (const name of noCount) {
			expect(VQL_DATE_LITERAL_DOCS[name].takesCount).toBe(false);
		}
		for (const name of VQL_DATE_LITERALS) {
			if (!noCount.includes(name)) {
				expect(VQL_DATE_LITERAL_DOCS[name].takesCount).toBe(true);
			}
		}
	});
});
