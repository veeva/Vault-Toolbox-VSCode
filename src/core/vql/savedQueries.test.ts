import { describe, it, expect } from 'vitest';
import { addSavedQuery, removeSavedQuery, savedQueryExists } from './savedQueries';

describe('addSavedQuery', () => {
	it('adds newest-first and trims name + query', () => {
		const list = addSavedQuery(
			addSavedQuery([], ' active docs ', ' SELECT id FROM documents '),
			'users',
			'SELECT id FROM users',
		);
		expect(list).toEqual([
			{ name: 'users', vql: 'SELECT id FROM users' },
			{ name: 'active docs', vql: 'SELECT id FROM documents' },
		]);
	});

	it('replaces an existing entry with the same name and moves it to the front', () => {
		let list = addSavedQuery([], 'q', 'SELECT id FROM documents');
		list = addSavedQuery(list, 'other', 'SELECT id FROM users');
		list = addSavedQuery(list, 'q', 'SELECT name__v FROM documents');
		expect(list).toEqual([
			{ name: 'q', vql: 'SELECT name__v FROM documents' },
			{ name: 'other', vql: 'SELECT id FROM users' },
		]);
	});

	it('ignores a blank name or query', () => {
		expect(addSavedQuery([], '  ', 'SELECT id FROM documents')).toEqual([]);
		expect(addSavedQuery([], 'q', '   ')).toEqual([]);
	});
});

describe('savedQueryExists', () => {
	const list = [
		{ name: 'active docs', vql: 'SELECT id FROM documents' },
		{ name: 'users', vql: 'SELECT id FROM users' },
	];

	it('matches an existing name, trimming whitespace', () => {
		expect(savedQueryExists(list, 'active docs')).toBe(true);
		expect(savedQueryExists(list, '  active docs  ')).toBe(true);
	});

	it('does not match an absent name', () => {
		expect(savedQueryExists(list, 'archived docs')).toBe(false);
	});

	it('is case-sensitive, mirroring addSavedQuery', () => {
		expect(savedQueryExists(list, 'Active Docs')).toBe(false);
	});

	it('treats a blank name as no match', () => {
		expect(savedQueryExists(list, '   ')).toBe(false);
	});
});

describe('removeSavedQuery', () => {
	it('removes by name and no-ops when absent', () => {
		const list = [
			{ name: 'a', vql: 'SELECT id FROM documents' },
			{ name: 'b', vql: 'SELECT id FROM users' },
		];
		expect(removeSavedQuery(list, 'a')).toEqual([{ name: 'b', vql: 'SELECT id FROM users' }]);
		expect(removeSavedQuery(list, 'missing')).toEqual(list);
	});
});
