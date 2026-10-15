import { describe, it, expect } from 'vitest';
import { formatVql } from './vqlFormat';

describe('formatVql', () => {
	it('puts each clause on its own line and indents SELECT fields', () => {
		expect(formatVql("select id, name__v from person__sys where status__v = 'active'")).toBe(
			['SELECT', '    id,', '    name__v', 'FROM person__sys', "WHERE status__v = 'active'"].join(
				'\n',
			),
		);
	});

	it('breaks top-level AND/OR in WHERE onto their own indented lines', () => {
		expect(formatVql('SELECT id FROM documents WHERE a = 1 AND b = 2 OR c = 3')).toBe(
			['SELECT', '    id', 'FROM documents', 'WHERE a = 1', '    AND b = 2', '    OR c = 3'].join(
				'\n',
			),
		);
	});

	it('upper-cases clause and operator keywords but preserves field/value case', () => {
		expect(formatVql("select Name__v from Doc__c where State__v like 'CA'")).toBe(
			['SELECT', '    Name__v', 'FROM Doc__c', "WHERE State__v LIKE 'CA'"].join('\n'),
		);
	});

	it('leaves commas, keywords, and connectors inside string literals untouched', () => {
		expect(formatVql("SELECT id FROM documents WHERE name__v = 'a, b and c'")).toBe(
			['SELECT', '    id', 'FROM documents', "WHERE name__v = 'a, b and c'"].join('\n'),
		);
	});

	it('formats a relationship sub-query multi-line, indented under its SELECT field', () => {
		expect(formatVql('SELECT (SELECT id, name__v FROM children__cr) FROM documents')).toBe(
			[
				'SELECT',
				'    (',
				'        SELECT',
				'            id,',
				'            name__v',
				'        FROM children__cr',
				'    )',
				'FROM documents',
			].join('\n'),
		);
	});

	it('formats a sub-query that trails top-level SELECT fields', () => {
		expect(formatVql('SELECT id, name__v, (SELECT id FROM children__cr) FROM documents')).toBe(
			[
				'SELECT',
				'    id,',
				'    name__v,',
				'    (',
				'        SELECT',
				'            id',
				'        FROM children__cr',
				'    )',
				'FROM documents',
			].join('\n'),
		);
	});

	it('formats a WHERE clause coexisting with a sub-query field', () => {
		expect(
			formatVql(
				"SELECT id, (SELECT name__v FROM children__cr) FROM documents WHERE status__v = 'active'",
			),
		).toBe(
			[
				'SELECT',
				'    id,',
				'    (',
				'        SELECT',
				'            name__v',
				'        FROM children__cr',
				'    )',
				'FROM documents',
				"WHERE status__v = 'active'",
			].join('\n'),
		);
	});

	it('is idempotent: formatting already-formatted output is a no-op', () => {
		const query =
			"SELECT id, (SELECT id, name__v FROM children__cr) FROM documents WHERE status__v = 'active' ORDER BY name__v DESC";
		const once = formatVql(query);
		expect(formatVql(once)).toBe(once);
	});

	it('leaves a parenthesised non-sub-query field inline', () => {
		expect(formatVql('SELECT id, TOLABEL(status__v) FROM documents')).toBe(
			['SELECT', '    id,', '    TOLABEL(status__v)', 'FROM documents'].join('\n'),
		);
	});

	it('handles ORDER BY / GROUP BY as a single clause and normalizes whitespace', () => {
		expect(formatVql('SELECT id FROM documents   ORDER  BY name__v desc')).toBe(
			['SELECT', '    id', 'FROM documents', 'ORDER BY name__v DESC'].join('\n'),
		);
	});

	it('breaks LIMIT / OFFSET onto their own top-level lines', () => {
		expect(formatVql('SELECT id FROM documents WHERE a = 1 LIMIT 100 OFFSET 10')).toBe(
			['SELECT', '    id', 'FROM documents', 'WHERE a = 1', 'LIMIT 100', 'OFFSET 10'].join('\n'),
		);
	});

	it('keeps AND/OR inside parentheses inline (only top-level connectors break)', () => {
		expect(formatVql('SELECT id FROM documents WHERE (a = 1 and b = 2) or c = 3')).toBe(
			['SELECT', '    id', 'FROM documents', 'WHERE (a = 1 AND b = 2)', '    OR c = 3'].join('\n'),
		);
	});

	it('emits a bare WHERE line when the WHERE body is empty', () => {
		expect(formatVql('SELECT id FROM documents WHERE')).toBe(
			['SELECT', '    id', 'FROM documents', 'WHERE'].join('\n'),
		);
	});

	it('returns blank input unchanged and leaves non-statements whitespace-normalised', () => {
		expect(formatVql('')).toBe('');
		expect(formatVql('   ')).toBe('');
		expect(formatVql('just  some   text')).toBe('just some text');
	});
});
