import { describe, expect, it } from 'vitest';
import { boundaryBefore, isWordChar, isWordStart } from './vqlLex';

describe('isWordStart', () => {
	it('accepts letters and underscore', () => {
		expect(isWordStart('a')).toBe(true);
		expect(isWordStart('Z')).toBe(true);
		expect(isWordStart('_')).toBe(true);
	});

	it('rejects digits, whitespace, and punctuation', () => {
		expect(isWordStart('0')).toBe(false);
		expect(isWordStart(' ')).toBe(false);
		expect(isWordStart('(')).toBe(false);
	});
});

describe('isWordChar', () => {
	it('accepts letters, digits, and underscore', () => {
		expect(isWordChar('a')).toBe(true);
		expect(isWordChar('9')).toBe(true);
		expect(isWordChar('_')).toBe(true);
	});

	it('rejects whitespace and punctuation', () => {
		expect(isWordChar(' ')).toBe(false);
		expect(isWordChar(',')).toBe(false);
	});
});

describe('boundaryBefore', () => {
	it('is true at the start of the string', () => {
		expect(boundaryBefore('name', 0)).toBe(true);
	});

	it('is true after whitespace or punctuation', () => {
		expect(boundaryBefore('a b', 2)).toBe(true);
		expect(boundaryBefore('a,b', 2)).toBe(true);
		expect(boundaryBefore('a(b', 2)).toBe(true);
	});

	it('is false in the middle of a word (after a letter, digit, or underscore)', () => {
		expect(boundaryBefore('abc', 1)).toBe(false);
		expect(boundaryBefore('a1', 1)).toBe(false);
		expect(boundaryBefore('a_b', 2)).toBe(false);
	});
});
