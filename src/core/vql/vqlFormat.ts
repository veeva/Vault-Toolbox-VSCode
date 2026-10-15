/**
 * Reformats a VQL statement for readability: each top-level
 * clause on its own line, one SELECT field per indented line, and top-level AND/OR conditions in
 * WHERE broken onto their own lines. Clause/operator keywords are upper-cased; field and value text
 * keep their original case. Whitespace-, string-, and parenthesis-aware, so commas, keywords, and
 * connectors inside string literals are left untouched.
 *
 * A relationship sub-query `(SELECT … FROM <relationship>)` appearing as a SELECT field is formatted
 * recursively — its opening paren, inner clauses (each on their own line, one inner field per line),
 * and closing paren indented one level under the enclosing SELECT — so a query the VQL Builder
 * assembles and the same query hand-typed then reformatted are byte-identical. Formatting is
 * idempotent: re-formatting already-formatted output is a no-op.
 *
 * Kept vscode-free so it serves both the webview Monaco format action and any future native command.
 */

import { CLAUSE_KEYWORDS, OPERATOR_KEYWORDS } from './vqlKeywords';
import { boundaryBefore, isWordChar, isWordStart } from './vqlLex';

const INDENT = '    ';

/**
 * Return the formatted query, or the input (whitespace-normalised) unchanged when it does not look
 * like a recognisable statement (no top-level clause keyword found).
 */
export function formatVql(vql: string): string {
	if (vql == null) {
		return '';
	}
	const normalized = normalizeWhitespace(vql).trim();
	if (normalized.length === 0) {
		return normalized;
	}

	const bounds = clauseBoundaries(normalized);
	if (bounds.length === 0) {
		return normalized;
	}

	return formatClauses(normalized, bounds, 0);
}

/**
 * Emit each clause of `query` on its own line, indented `indentLevel` levels deep. SELECT fields and
 * WHERE conditions indent one level further. Recurses for relationship sub-queries nested in SELECT.
 */
function formatClauses(query: string, bounds: ClauseBound[], indentLevel: number): string {
	const pad = INDENT.repeat(indentLevel);
	let out = '';
	for (let index = 0; index < bounds.length; index++) {
		const { start, length } = bounds[index];
		const end = index + 1 < bounds.length ? bounds[index + 1].start : query.length;

		const keyword = query.substring(start, start + length).toUpperCase();
		const body = query.substring(start + length, end).trim();

		if (index > 0) {
			out += '\n';
		}
		if (keyword === 'SELECT') {
			out += pad + 'SELECT' + fieldList(body, indentLevel);
		} else if (keyword === 'WHERE') {
			out += pad + 'WHERE' + conditions(body, indentLevel);
		} else {
			out += pad + keyword;
			if (body.length > 0) {
				out += ' ' + upperKeywords(body);
			}
		}
	}
	return out;
}

/**
 * Each top-level, comma-separated field on its own line, indented one level past `indentLevel`. A
 * field that is a single relationship sub-query is formatted recursively rather than inline.
 */
function fieldList(body: string, indentLevel: number): string {
	const fields = splitTopLevel(body, ',');
	const fieldPad = INDENT.repeat(indentLevel + 1);
	let out = '';
	for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
		const field = fields[fieldIndex].trim();
		if (field.length === 0) {
			continue;
		}
		const subquery = formatSubqueryField(field, indentLevel + 1);
		out += '\n' + (subquery !== null ? subquery : fieldPad + upperKeywords(field));
		if (fieldIndex < fields.length - 1) {
			out += ',';
		}
	}
	return out;
}

/**
 * When `field` is a single parenthesised `(SELECT … FROM …)` sub-query, format its clauses on their
 * own lines with the parens indented `indentLevel` levels deep; otherwise return `null` so the
 * caller renders the field inline. The inner query is reformatted by the same `formatClauses` pass as
 * the top level — a hand-typed inner WHERE/ORDER BY is fully broken out too (the v1 Builder only
 * emits field-list sub-queries, but Format Document handles the general case).
 */
function formatSubqueryField(field: string, indentLevel: number): string | null {
	if (!isSingleParenGroup(field)) {
		return null;
	}
	const inner = field.substring(1, field.length - 1).trim();
	const bounds = clauseBoundaries(inner);
	if (bounds.length === 0) {
		return null;
	}
	const firstKeyword = inner.substring(bounds[0].start, bounds[0].start + bounds[0].length);
	if (firstKeyword.toUpperCase() !== 'SELECT') {
		return null;
	}
	const pad = INDENT.repeat(indentLevel);
	return pad + '(\n' + formatClauses(inner, bounds, indentLevel + 1) + '\n' + pad + ')';
}

/** True when `field` is one balanced parenthesised group: `(…)` whose open paren closes only at the
 *  final character (so `(a) = (b)` is rejected but `(SELECT (x) FROM y)` is accepted). */
function isSingleParenGroup(field: string): boolean {
	if (!field.startsWith('(') || !field.endsWith(')')) {
		return false;
	}
	let depth = 0;
	let inString = false;
	for (let charIndex = 0; charIndex < field.length; charIndex++) {
		const currentChar = field[charIndex];
		if (inString) {
			if (currentChar === "'") {
				inString = false;
			}
		} else if (currentChar === "'") {
			inString = true;
		} else if (currentChar === '(') {
			depth++;
		} else if (currentChar === ')') {
			depth--;
			if (depth === 0 && charIndex < field.length - 1) {
				return false;
			}
		}
	}
	return depth === 0;
}

/** The first condition after WHERE, then each top-level AND/OR on its own line, indented one level
 *  past `indentLevel`. */
function conditions(body: string, indentLevel: number): string {
	if (body.length === 0) {
		return '';
	}
	const conditionPad = INDENT.repeat(indentLevel + 1);
	const parts = splitConditions(body);
	let out = '';
	for (let conditionIndex = 0; conditionIndex < parts.length; conditionIndex++) {
		const [connector, condition] = parts[conditionIndex];
		const trimmed = condition.trim();
		if (conditionIndex === 0) {
			out += ' ' + upperKeywords(trimmed);
		} else {
			out += '\n' + conditionPad + connector + ' ' + upperKeywords(trimmed);
		}
	}
	return out;
}

/** Start offset and length of a top-level clause keyword within the query. */
interface ClauseBound {
	start: number;
	length: number;
}

/**
 * Scan `text` left to right, invoking `onWord` for each whole word at the top level — outside
 * string literals and outside parentheses. Return a number from `onWord` to resume scanning from
 * that offset (used for the "ORDER BY"/"GROUP BY" two-word lookahead); return nothing to continue
 * after the word. Shared by the clause and condition splitters, which differ only in what they do
 * at each top-level word.
 */
function scanTopLevelWords(
	text: string,
	onWord: (word: string, start: number, end: number) => number | undefined,
): void {
	let depth = 0;
	let inString = false;
	let charIndex = 0;
	const textLength = text.length;
	while (charIndex < textLength) {
		const currentChar = text[charIndex];
		if (inString) {
			if (currentChar === "'") {
				inString = false;
			}
			charIndex++;
		} else if (currentChar === "'") {
			inString = true;
			charIndex++;
		} else if (currentChar === '(') {
			depth++;
			charIndex++;
		} else if (currentChar === ')') {
			depth--;
			charIndex++;
		} else if (depth === 0 && isWordStart(currentChar) && boundaryBefore(text, charIndex)) {
			let wordEndIndex = charIndex;
			while (wordEndIndex < textLength && isWordChar(text[wordEndIndex])) {
				wordEndIndex++;
			}
			const jump = onWord(text.substring(charIndex, wordEndIndex), charIndex, wordEndIndex);
			charIndex = typeof jump === 'number' ? jump : wordEndIndex;
		} else {
			charIndex++;
		}
	}
}

/** Start offset and length of each top-level clause keyword, in order. */
function clauseBoundaries(query: string): ClauseBound[] {
	const result: ClauseBound[] = [];
	const length = query.length;
	scanTopLevelWords(query, (word, start, end) => {
		const lower = word.toLowerCase();
		if (lower === 'order' || lower === 'group') {
			let byStart = end;
			while (byStart < length && query[byStart] === ' ') {
				byStart++;
			}
			let byEnd = byStart;
			while (byEnd < length && isWordChar(query[byEnd])) {
				byEnd++;
			}
			if (query.substring(byStart, byEnd).toLowerCase() === 'by') {
				result.push({ start, length: byEnd - start });
				return byEnd;
			}
		} else if (CLAUSE_KEYWORDS.has(lower)) {
			result.push({ start, length: end - start });
		}
		return undefined;
	});
	return result;
}

/** Splits on top-level AND/OR; each entry is `[connector, conditionText]` (first connector empty). */
function splitConditions(body: string): Array<[string, string]> {
	const parts: Array<[string, string]> = [];
	let last = 0;
	let connector = '';
	scanTopLevelWords(body, (word, start, end) => {
		const lower = word.toLowerCase();
		if (lower === 'and' || lower === 'or') {
			parts.push([connector, body.substring(last, start)]);
			connector = lower.toUpperCase();
			last = end;
		}
		return undefined;
	});
	parts.push([connector, body.substring(last)]);
	return parts;
}

/** Splits on a top-level delimiter, ignoring delimiters inside parentheses or strings. */
function splitTopLevel(input: string, delimiter: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let inString = false;
	let last = 0;
	for (let charIndex = 0; charIndex < input.length; charIndex++) {
		const currentChar = input[charIndex];
		if (inString) {
			if (currentChar === "'") {
				inString = false;
			}
		} else if (currentChar === "'") {
			inString = true;
		} else if (currentChar === '(') {
			depth++;
		} else if (currentChar === ')') {
			depth--;
		} else if (currentChar === delimiter && depth === 0) {
			parts.push(input.substring(last, charIndex));
			last = charIndex + 1;
		}
	}
	parts.push(input.substring(last));
	return parts;
}

/** Upper-cases OPERATOR_KEYWORDS appearing as whole words, leaving strings and identifiers alone. */
function upperKeywords(text: string): string {
	let out = '';
	let inString = false;
	let charIndex = 0;
	const textLength = text.length;
	while (charIndex < textLength) {
		const currentChar = text[charIndex];
		if (inString) {
			out += currentChar;
			if (currentChar === "'") {
				inString = false;
			}
			charIndex++;
		} else if (currentChar === "'") {
			inString = true;
			out += currentChar;
			charIndex++;
		} else if (isWordStart(currentChar) && boundaryBefore(text, charIndex)) {
			let wordEndIndex = charIndex;
			while (wordEndIndex < textLength && isWordChar(text[wordEndIndex])) {
				wordEndIndex++;
			}
			const word = text.substring(charIndex, wordEndIndex);
			out += OPERATOR_KEYWORDS.has(word.toLowerCase()) ? word.toUpperCase() : word;
			charIndex = wordEndIndex;
		} else {
			out += currentChar;
			charIndex++;
		}
	}
	return out;
}

/** Collapses runs of whitespace to a single space, preserving content inside string literals. */
function normalizeWhitespace(input: string): string {
	let out = '';
	let inString = false;
	let prevSpace = false;
	for (let charIndex = 0; charIndex < input.length; charIndex++) {
		const currentChar = input[charIndex];
		if (inString) {
			out += currentChar;
			if (currentChar === "'") {
				inString = false;
			}
		} else if (currentChar === "'") {
			inString = true;
			out += currentChar;
			prevSpace = false;
		} else if (/\s/.test(currentChar)) {
			if (!prevSpace) {
				out += ' ';
				prevSpace = true;
			}
		} else {
			out += currentChar;
			prevSpace = false;
		}
	}
	return out;
}
