import { describe, it, expect } from 'vitest';
import { addToHistory, MAX_HISTORY } from './queryHistory';

describe('addToHistory', () => {
	it('adds a new query to the front (newest first)', () => {
		expect(addToHistory(['a'], 'b')).toEqual(['b', 'a']);
	});

	it('moves an existing query to the front instead of duplicating it', () => {
		expect(addToHistory(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
	});

	it('trims the query and ignores a blank one', () => {
		expect(addToHistory(['a'], '  b  ')).toEqual(['b', 'a']);
		expect(addToHistory(['a', 'b'], '   ')).toEqual(['a', 'b']);
	});

	it('caps the list from the tail, dropping the oldest', () => {
		const start = Array.from({ length: MAX_HISTORY }, (_, i) => `q${i}`);
		const result = addToHistory(start, 'new');
		expect(result).toHaveLength(MAX_HISTORY);
		expect(result[0]).toBe('new');
		expect(result).not.toContain(`q${MAX_HISTORY - 1}`); // oldest dropped
	});

	it('honors a custom cap', () => {
		expect(addToHistory(['a', 'b'], 'c', 2)).toEqual(['c', 'a']);
	});
});
