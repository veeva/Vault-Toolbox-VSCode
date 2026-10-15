import { VQL_KEYWORDS, type VqlOptionContext } from './vqlKeywords';

/**
 * The pure, DOM-free core of context-aware VQL completion. It turns a Monaco token stream —
 * read up to the cursor — into a {@link CompletionPlan} describing exactly what the completion
 * provider should offer at that spot: which metadata families (targets, fields, relationship names,
 * a picklist/boolean value list) and which pruned keyword set. The webview provider
 * (`webview/editor/vqlCompletion.ts`) owns the Monaco glue (tokenizing, async metadata fetches, item
 * construction); this owns the decision, so it can be unit-tested with hand-built token arrays
 * (the repo has no webview component-test harness).
 *
 * This is a tokenizer walk, not a parser: it reads the token stream backwards to the nearest
 * `keyword.vql.clause` token to know the clause, then classifies the intra-clause position from the
 * tokens to its right. It yields clause context, not nesting structure — the Monarch tokenizer tracks
 * no paren/subquery depth — so subquery interiors, `WHERE … IN (subquery)`, and multi-hop dotted
 * paths deliberately fall through to the permissive flat plan.
 */

/**
 * One token from the Monaco/Monarch tokenizer, reduced to what the walk needs: its scope `type`
 * (e.g. `keyword.vql.clause`, `keyword.vql.operator`, `identifier`, `string`, `delimiter`) and its
 * source `text`. Matching is by substring so a language-id suffix (e.g. `.vql`) never breaks a predicate.
 */
export interface VqlToken {
	type: string;
	text: string;
}

/**
 * What the completion provider should offer at the cursor. Every field is optional/pruned: a field
 * position sets `fields`/`relationshipNames`; a WHERE operator position sets `operatorsForField`; a
 * value position sets `valuesForField`; and `keywords` is the exact (possibly empty) keyword list
 * valid there. The flat fallback ({@link FLAT_PLAN}) sets `targets`, `fields`, and the full keyword
 * set, reproducing the permissive provider for spots the walk can't classify.
 */
export interface CompletionPlan {
	/** Offer the Vault query-target (`SHOW TARGETS`) names. */
	targets?: boolean;
	/** Offer the `FROM` object's own fields. */
	fields?: boolean;
	/** Offer the `FROM` object's outbound relationship names (a distinct completion kind). */
	relationshipNames?: boolean;
	/** Offer the hardcoded one-hop standard field set after `rel__cr.`. */
	relationshipFields?: boolean;
	/** The relationship name preceding the `.` (the first hop), so the provider can offer the document
	 *  field set for a document relationship and the object set otherwise. Set with `relationshipFields`. */
	relationshipName?: string;
	/** Offer only the filter operators valid for this field's type (WHERE operator position). */
	operatorsForField?: string;
	/** Offer this field's value list — picklist/boolean/date literals + `null` (WHERE value position). */
	valuesForField?: string;
	/** Offer the VQL functions (SELECT / WHERE / ORDER BY / FIND positions), inserted as `FN(…)`. */
	functions?: boolean;
	/** Offer the VQL query-target options for this clause: the version/user options after `FROM`, or
	 *  the search scopes after `FIND`. */
	options?: VqlOptionContext;
	/** The pruned keyword suggestions valid here, upper-cased. Empty means "no keywords". */
	keywords: readonly string[];
}

/** The permissive fallback plan: targets + fields + the full keyword set. Used at query start and for
 *  any spot the walk can't classify (unknown clause, subquery interior), so completion never gets
 *  *worse* than it was before context-awareness. */
export const FLAT_PLAN: CompletionPlan = {
	targets: true,
	fields: true,
	keywords: VQL_KEYWORDS,
};

/** The result-handling clauses that may trail a query, in doc order. VQL's modern clauses — the
 *  deprecated `LIMIT`/`OFFSET` synonyms are still highlighted but never suggested here. */
const RESULT_CLAUSES = ['MAXROWS', 'SKIP', 'PAGESIZE', 'PAGEOFFSET'] as const;
/** After a complete SELECT list: FROM, or AS to alias the field/function just written. */
const AFTER_SELECT_FIELD_KEYWORDS = ['FROM', 'AS'] as const;
/** After the FROM object, the clauses that may follow. */
const AFTER_FROM_KEYWORDS = ['WHERE', 'FIND', 'ORDER BY', ...RESULT_CLAUSES] as const;
/** After a complete WHERE condition: the logical connectors plus the clauses that may follow. */
const AFTER_CONDITION_KEYWORDS = ['AND', 'OR', 'ORDER BY', ...RESULT_CLAUSES] as const;
/** After an ORDER BY sort field: direction keywords plus the clauses that may follow. */
const AFTER_ORDER_FIELD_KEYWORDS = ['ASC', 'DESC', ...RESULT_CLAUSES] as const;
/** After an explicit ASC/DESC: only the clauses that may follow (a comma continues the field list). */
const AFTER_ORDER_DIRECTION_KEYWORDS = [...RESULT_CLAUSES] as const;
/** Inside a FIND clause: the logical connectors valid in the search string (options add the scopes). */
const FIND_KEYWORDS = ['AND', 'OR', 'NOT'] as const;
/** After a bare SHOW: the metadata categories it can list (`SHOW TARGETS|FIELDS|RELATIONSHIPS`). */
const SHOW_KEYWORDS = ['TARGETS', 'FIELDS', 'RELATIONSHIPS'] as const;

/** WHERE logical connectors that end one condition and begin the next. */
const CONNECTOR_WORDS: ReadonlySet<string> = new Set(['and', 'or']);
/** Word-form comparison operators (symbol operators like `=`/`<=` are matched by shape, not text). */
const COMPARISON_WORDS: ReadonlySet<string> = new Set(['like', 'contains', 'in', 'between']);
/** Comparison operators that open a value *list* (`CONTAINS (a, b)`), so the value position holds
 *  until the list's closing paren rather than ending after the first value. */
const LIST_COMPARISON_WORDS: ReadonlySet<string> = new Set(['contains', 'in']);
/** ORDER BY sort-direction keywords. */
const DIRECTION_WORDS: ReadonlySet<string> = new Set(['asc', 'desc']);

const isClause = (token: VqlToken): boolean => token.type.includes('keyword.vql.clause');
const isOperator = (token: VqlToken): boolean => token.type.includes('keyword.vql.operator');
const isIdentifier = (token: VqlToken): boolean => token.type.includes('identifier');
const isDelimiter = (token: VqlToken, char: string): boolean =>
	token.type.includes('delimiter') && token.text.trim() === char;
const isSymbolComparison = (token: VqlToken): boolean =>
	isOperator(token) && /^(=|!=|<>|<|>|<=|>=)$/.test(token.text.trim());
const isComparison = (token: VqlToken): boolean =>
	isSymbolComparison(token) || (isOperator(token) && COMPARISON_WORDS.has(token.text.toLowerCase()));

/** Join a dotted field path's identifiers with `.` (e.g. `[owner__cr, ., name__v]` → `owner__cr.name__v`). */
function dottedPath(tokens: readonly VqlToken[]): string {
	return tokens
		.filter(isIdentifier)
		.map((token) => token.text)
		.join('.');
}

/**
 * The clause governing the cursor and the index just past its head, found by walking back to the
 * nearest `keyword.vql.clause` token. `ORDER BY` / `GROUP BY` are two-token heads (both words tokenize
 * as clause keywords), so a trailing `by` is resolved against the clause word before it. Returns
 * `null` when no clause keyword precedes the cursor (query start).
 */
function detectClause(tokens: readonly VqlToken[]): { clause: string; headEnd: number } | null {
	for (let i = tokens.length - 1; i >= 0; i--) {
		if (!isClause(tokens[i])) {
			continue;
		}
		const word = tokens[i].text.toLowerCase();
		if (word === 'by') {
			const prev = i > 0 && isClause(tokens[i - 1]) ? tokens[i - 1].text.toLowerCase() : undefined;
			return { clause: prev === 'group' ? 'group by' : 'order by', headEnd: i + 1 };
		}
		return { clause: word, headEnd: i + 1 };
	}
	return null;
}

/**
 * Plan completion at the cursor from the committed tokens before it (the in-progress word already
 * removed by the caller). Whitespace tokens are dropped; string tokens are kept as value markers but
 * are never clause keywords, so they're skipped implicitly by the backward clause walk.
 */
export function planCompletion(rawTokens: readonly VqlToken[]): CompletionPlan {
	const tokens = rawTokens.filter((token) => token.text.trim().length > 0);
	const detected = detectClause(tokens);
	if (!detected) {
		return FLAT_PLAN;
	}
	const segment = tokens.slice(detected.headEnd);
	switch (detected.clause) {
		case 'select':
			return planSelect(segment);
		case 'from':
			return planFrom(segment);
		case 'where':
			return planWhere(segment);
		case 'find':
			return planFind();
		case 'show':
			return planShow(segment);
		case 'order by':
			return planOrderBy(segment);
		case 'order':
		case 'group':
			// A bare `ORDER`/`GROUP` still needs its `BY` before any field can follow.
			return { keywords: ['BY'] };
		default:
			return FLAT_PLAN;
	}
}

/** Depth of the trailing dotted run ending in `.` (dots in the maximal trailing `id . id . …` run):
 *  1 = a first hop (`rel.`), ≥2 = beyond one hop. `0` when the run doesn't end in a dot. */
function trailingDotDepth(tokens: readonly VqlToken[]): number {
	let dots = 0;
	for (let i = tokens.length - 1; i >= 0; i--) {
		if (isDelimiter(tokens[i], '.')) {
			dots++;
		} else if (!isIdentifier(tokens[i])) {
			break;
		}
	}
	return isDelimiter(tokens[tokens.length - 1], '.') ? dots : 0;
}

/** The field-position plan shared by SELECT, WHERE-field, and ORDER BY-field: own fields plus outbound
 *  relationship names, no keywords (a field/relationship is expected, not a clause word). */
const FIELD_POSITION: CompletionPlan = {
	fields: true,
	relationshipNames: true,
	functions: true,
	keywords: [],
};
/** No suggestions (e.g. a second dotted hop, which v1 doesn't complete). */
const NO_SUGGESTIONS: CompletionPlan = { keywords: [] };

/** Classify a dotted trailing run into the relationship-field plan (first hop, carrying the
 *  relationship name so the provider can pick the object vs document field set) or silence (deeper). */
function planTrailingDot(tokens: readonly VqlToken[]): CompletionPlan {
	if (trailingDotDepth(tokens) !== 1) {
		return NO_SUGGESTIONS;
	}
	// Whitespace tokens are already filtered out, so the identifier is directly before the trailing `.`.
	const relationship = tokens[tokens.length - 2];
	return {
		relationshipFields: true,
		relationshipName: relationship?.text,
		keywords: [],
	};
}

function planSelect(segment: readonly VqlToken[]): CompletionPlan {
	if (segment.length === 0) {
		return FIELD_POSITION;
	}
	const last = segment[segment.length - 1];
	if (isDelimiter(last, '.')) {
		return planTrailingDot(segment);
	}
	if (isDelimiter(last, ',')) {
		return FIELD_POSITION;
	}
	if (isIdentifier(last) || isDelimiter(last, ')')) {
		return { keywords: AFTER_SELECT_FIELD_KEYWORDS };
	}
	return FIELD_POSITION;
}

function planFrom(segment: readonly VqlToken[]): CompletionPlan {
	if (segment.length === 0) {
		// The query target, plus the version/user options that precede it (`FROM ALLVERSIONS documents`).
		return { targets: true, options: 'from', keywords: [] };
	}
	return { keywords: AFTER_FROM_KEYWORDS };
}

/**
 * Plan the FIND clause. The Monarch tokenizer tracks no paren/string depth, so this offers the FIND
 * vocabulary permissively — the search scopes (`SCOPE ALL|CONTENT|PROPERTIES`, `DISTANCE`) and the
 * logical connectors valid inside the search phrase — rather than by exact position within the
 * `('…' SCOPE …)` group.
 */
function planFind(): CompletionPlan {
	return { options: 'find', keywords: FIND_KEYWORDS };
}

/**
 * Plan the SHOW clause. Immediately after `SHOW`, offer the metadata categories it can list. Once one
 * is written it tokenizes as a clause keyword (`TARGETS`/`FIELDS`/`RELATIONSHIPS`), so the backward
 * clause walk resolves to that word and this plan is not re-entered — the flat fallback then handles
 * any `FROM` continuation (`SHOW FIELDS FROM object__v`).
 */
function planShow(segment: readonly VqlToken[]): CompletionPlan {
	return segment.length === 0 ? { keywords: SHOW_KEYWORDS } : FLAT_PLAN;
}

function planWhere(segment: readonly VqlToken[]): CompletionPlan {
	// The current condition is everything after the last AND/OR connector.
	let start = 0;
	for (let i = 0; i < segment.length; i++) {
		if (isOperator(segment[i]) && CONNECTOR_WORDS.has(segment[i].text.toLowerCase())) {
			start = i + 1;
		}
	}
	const fragment = segment.slice(start);
	if (fragment.length === 0) {
		return FIELD_POSITION;
	}

	let comparisonIndex = -1;
	for (let i = 0; i < fragment.length; i++) {
		if (isComparison(fragment[i])) {
			comparisonIndex = i;
		}
	}

	if (comparisonIndex === -1) {
		const last = fragment[fragment.length - 1];
		if (isDelimiter(last, '.')) {
			return planTrailingDot(fragment);
		}
		return { operatorsForField: dottedPath(fragment), keywords: [] };
	}

	const field = dottedPath(fragment.slice(0, comparisonIndex));
	const after = fragment.slice(comparisonIndex + 1);
	const opensList = LIST_COMPARISON_WORDS.has(fragment[comparisonIndex].text.toLowerCase());
	const listClosed = after.some((token) => isDelimiter(token, ')'));
	const stillInValue = after.length === 0 || (opensList && !listClosed);
	return stillInValue
		? // Value-side functions (`= STATETYPE(…)`, `= DELETEDSTATE()`) belong here too; the field's
			// own values, date literals, and `null` are resolved from the field type by the provider.
			{ valuesForField: field, functions: true, keywords: [] }
		: { keywords: AFTER_CONDITION_KEYWORDS };
}

function planOrderBy(segment: readonly VqlToken[]): CompletionPlan {
	// The current sort term is everything after the last comma.
	let start = 0;
	for (let i = 0; i < segment.length; i++) {
		if (isDelimiter(segment[i], ',')) {
			start = i + 1;
		}
	}
	const fragment = segment.slice(start);
	if (fragment.length === 0) {
		return FIELD_POSITION;
	}
	const last = fragment[fragment.length - 1];
	if (isDelimiter(last, '.')) {
		return planTrailingDot(fragment);
	}
	if (isOperator(last) && DIRECTION_WORDS.has(last.text.toLowerCase())) {
		return { keywords: AFTER_ORDER_DIRECTION_KEYWORDS };
	}
	if (isIdentifier(last) || isDelimiter(last, ')')) {
		return { keywords: AFTER_ORDER_FIELD_KEYWORDS };
	}
	return FIELD_POSITION;
}
