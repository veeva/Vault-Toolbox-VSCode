import { describe, it, expect } from 'vitest';
import { planCompletion, FLAT_PLAN, type VqlToken } from './completionContext';
import { VQL_CLAUSE_KEYWORDS, VQL_OPERATOR_KEYWORDS } from './vqlKeywords';

/**
 * A test-local lexer mirroring the Monaco Monarch grammar in `webview/editor/vqlLanguage.ts`, using
 * the same core keyword sets so its token types match what the real tokenizer emits. It lets each case
 * read as the VQL text before the cursor (the in-progress word omitted, exactly as the provider feeds
 * the walk) rather than a hand-built token array.
 */
const CLAUSE = new Set(VQL_CLAUSE_KEYWORDS.map((word) => word.toLowerCase()));
const OPERATOR = new Set(VQL_OPERATOR_KEYWORDS.map((word) => word.toLowerCase()));

function lex(source: string): VqlToken[] {
	const tokens: VqlToken[] = [];
	let i = 0;
	while (i < source.length) {
		const char = source[i];
		if (/\s/.test(char)) {
			let j = i;
			while (j < source.length && /\s/.test(source[j])) j++;
			tokens.push({ type: '', text: source.slice(i, j) });
			i = j;
		} else if (/[A-Za-z_$]/.test(char)) {
			let j = i;
			while (j < source.length && /[\w$]/.test(source[j])) j++;
			const word = source.slice(i, j);
			const lower = word.toLowerCase();
			const type = CLAUSE.has(lower)
				? 'keyword.vql.clause'
				: OPERATOR.has(lower)
					? 'keyword.vql.operator'
					: 'identifier';
			tokens.push({ type, text: word });
			i = j;
		} else if (/[0-9]/.test(char)) {
			let j = i;
			while (j < source.length && /[0-9.]/.test(source[j])) j++;
			tokens.push({ type: 'number', text: source.slice(i, j) });
			i = j;
		} else if (char === "'" || char === '"') {
			let j = i + 1;
			while (j < source.length) {
				if (source[j] === '\\') {
					j += 2;
					continue;
				}
				const closed = source[j] === char;
				j++;
				if (closed) break;
			}
			tokens.push({ type: 'string', text: source.slice(i, j) });
			i = j;
		} else if ('(),.'.includes(char)) {
			tokens.push({ type: 'delimiter', text: char });
			i++;
		} else if ('=<>!'.includes(char)) {
			let j = i;
			while (j < source.length && '=<>!'.includes(source[j])) j++;
			tokens.push({ type: 'keyword.vql.operator', text: source.slice(i, j) });
			i = j;
		} else if ('-+*/'.includes(char)) {
			tokens.push({ type: 'keyword.vql.operator', text: char });
			i++;
		} else {
			i++;
		}
	}
	return tokens;
}

const plan = (source: string) => planCompletion(lex(source));

/** The shared field-position plan (SELECT / WHERE-field / ORDER BY-field): fields + outbound
 *  relationships + functions, no clause keywords. */
const FIELD_POSITION = { fields: true, relationshipNames: true, functions: true, keywords: [] };
/** The modern result-handling clauses that may trail a query, in doc order (no deprecated LIMIT). */
const RESULT_CLAUSES = ['MAXROWS', 'SKIP', 'PAGESIZE', 'PAGEOFFSET'];

describe('planCompletion — clause detection', () => {
	it('falls back to the flat plan at query start (no clause keyword yet)', () => {
		expect(plan('')).toBe(FLAT_PLAN);
		expect(plan('SEL')).toBe(FLAT_PLAN);
	});

	it('falls back to the flat plan once a SHOW category is written', () => {
		// TARGETS tokenizes as a clause keyword, so the walk resolves to it, not SHOW.
		expect(plan('SHOW TARGETS ')).toBe(FLAT_PLAN);
	});

	it('reads the nearest clause and is not fooled by clause words inside a string literal', () => {
		// The `select`/`from` words inside the WHERE value string must not switch the detected clause.
		expect(plan("SELECT id FROM o WHERE name__v = 'select from where' ")).toEqual({
			keywords: ['AND', 'OR', 'ORDER BY', ...RESULT_CLAUSES],
		});
	});
});

describe('planCompletion — SELECT list', () => {
	it('offers fields + outbound relationships + functions right after SELECT', () => {
		expect(plan('SELECT ')).toEqual(FIELD_POSITION);
	});

	it('offers fields again after a comma', () => {
		expect(plan('SELECT id, ')).toEqual(FIELD_POSITION);
	});

	it('suggests FROM/AS after a complete field (no trailing comma)', () => {
		expect(plan('SELECT id ')).toEqual({ keywords: ['FROM', 'AS'] });
	});
});

describe('planCompletion — FROM', () => {
	it('offers targets and the version/user options right after FROM', () => {
		expect(plan('SELECT id FROM ')).toEqual({ targets: true, options: 'from', keywords: [] });
	});

	it('suggests WHERE/FIND/ORDER BY + result clauses after the FROM object', () => {
		expect(plan('SELECT id FROM person__sys ')).toEqual({
			keywords: ['WHERE', 'FIND', 'ORDER BY', ...RESULT_CLAUSES],
		});
	});
});

describe('planCompletion — FIND', () => {
	it('offers the search scopes (options) plus the FIND connectors', () => {
		expect(plan("SELECT id FROM o FIND ('drug' ")).toEqual({
			options: 'find',
			keywords: ['AND', 'OR', 'NOT'],
		});
	});
});

describe('planCompletion — SHOW', () => {
	it('offers the metadata categories right after SHOW', () => {
		expect(plan('SHOW ')).toEqual({ keywords: ['TARGETS', 'FIELDS', 'RELATIONSHIPS'] });
	});
});

describe('planCompletion — WHERE positional awareness', () => {
	it('field position right after WHERE', () => {
		expect(plan('SELECT id FROM o WHERE ')).toEqual(FIELD_POSITION);
	});

	it('operator position after a field (carries the field name)', () => {
		expect(plan('SELECT id FROM o WHERE status__v ')).toEqual({
			operatorsForField: 'status__v',
			keywords: [],
		});
	});

	it('value position after an operator (carries the field name, offers value-side functions)', () => {
		expect(plan('SELECT id FROM o WHERE status__v = ')).toEqual({
			valuesForField: 'status__v',
			functions: true,
			keywords: [],
		});
	});

	it('after a complete condition offers AND/OR + next clauses', () => {
		expect(plan("SELECT id FROM o WHERE status__v = 'active' ")).toEqual({
			keywords: ['AND', 'OR', 'ORDER BY', ...RESULT_CLAUSES],
		});
	});

	it('returns to field position after AND', () => {
		expect(plan("SELECT id FROM o WHERE status__v = 'a' AND ")).toEqual(FIELD_POSITION);
	});

	it('stays in value position inside an open CONTAINS list', () => {
		expect(plan("SELECT id FROM o WHERE type__v CONTAINS ('a', ")).toEqual({
			valuesForField: 'type__v',
			functions: true,
			keywords: [],
		});
	});

	it('leaves value position once the CONTAINS list closes', () => {
		expect(plan("SELECT id FROM o WHERE type__v CONTAINS ('a', 'b') ")).toEqual({
			keywords: ['AND', 'OR', 'ORDER BY', ...RESULT_CLAUSES],
		});
	});
});

describe('planCompletion — ORDER BY (two-token head)', () => {
	it('field position after ORDER BY', () => {
		expect(plan('SELECT id FROM o ORDER BY ')).toEqual(FIELD_POSITION);
	});

	it('offers ASC/DESC + result clauses after a sort field', () => {
		expect(plan('SELECT id FROM o ORDER BY name__v ')).toEqual({
			keywords: ['ASC', 'DESC', ...RESULT_CLAUSES],
		});
	});

	it('offers only the result clauses after an explicit direction', () => {
		expect(plan('SELECT id FROM o ORDER BY name__v ASC ')).toEqual({ keywords: RESULT_CLAUSES });
	});

	it('returns to field position after a comma (list continuation)', () => {
		expect(plan('SELECT id FROM o ORDER BY name__v, ')).toEqual(FIELD_POSITION);
	});

	it('suggests BY after a bare ORDER', () => {
		expect(plan('SELECT id FROM o ORDER ')).toEqual({ keywords: ['BY'] });
	});
});

describe('planCompletion — relationship traversal (one hop)', () => {
	it('offers the standard field set after a first-hop dot in SELECT, naming the relationship', () => {
		expect(plan('SELECT owner__cr.')).toEqual({
			relationshipFields: true,
			relationshipName: 'owner__cr',
			keywords: [],
		});
	});

	it('offers the standard field set after a first-hop dot in WHERE, naming the relationship', () => {
		expect(plan('SELECT id FROM o WHERE owner__cr.')).toEqual({
			relationshipFields: true,
			relationshipName: 'owner__cr',
			keywords: [],
		});
	});

	it('offers nothing after a second dotted hop', () => {
		expect(plan('SELECT owner__cr.name__v.')).toEqual({ keywords: [] });
	});

	it('treats a completed dotted path as an operator-position field in WHERE', () => {
		expect(plan('SELECT id FROM o WHERE owner__cr.name__v ')).toEqual({
			operatorsForField: 'owner__cr.name__v',
			keywords: [],
		});
	});
});
