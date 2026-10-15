/**
 * The single source of truth for VQL's keyword grammar. Every consumer of "what are the VQL
 * keywords?" derives from here: the formatter's clause/operator sets ({@link CLAUSE_KEYWORDS},
 * {@link OPERATOR_KEYWORDS}), and the Monaco language's highlight + completion sets
 * ({@link VQL_KEYWORDS}, {@link VQL_CLAUSE_KEYWORDS}, {@link VQL_OPERATOR_KEYWORDS},
 * {@link VQL_FUNCTIONS}, {@link VQL_OPTIONS}). Kept vscode-/monaco-free so both the portable
 * formatter and the webview language definition import it without drifting apart.
 *
 * The three exported highlight sets (clause/operator/functions+options) mirror the three top-level
 * categories the VQL documentation itself uses (Clauses, Operators, Functions & Options), so the
 * editor's color grouping reads the same way the docs are organized.
 */

/** Single-word clauses that begin a new top-level line in the formatter. ORDER/GROUP → `... BY`. */
const CLAUSE_WORDS = [
	'select',
	'from',
	'show',
	'where',
	'limit',
	'offset',
	'skip',
	'pagesize',
	'maxrows',
	'find',
];

/** Two-word clause heads formatted/highlighted as `<word> BY`. */
const CLAUSE_BY_WORDS = ['order', 'group'];

/** Continuation word for the two-word clauses above (`ORDER BY`/`GROUP BY`) — highlighted as part
 *  of the clause itself, not as an operator, so the whole phrase reads as one color. */
const CLAUSE_BY_CONTINUATION = 'by';

/**
 * Highlight-only words that are part of a clause's own syntax (`ORDER BY RANK`, the `PAGEOFFSET`
 * clause, `SHOW TARGETS|FIELDS|RELATIONSHIPS`) but have no formatter role of their own — the
 * formatter never breaks a new top-level line at these words.
 */
const CLAUSE_ONLY_WORDS = ['rank', 'pageoffset', 'targets', 'fields', 'relationships'];

/** Operator/value keywords upper-cased wherever they appear as whole words (outside strings). VQL has
 *  no `IS` operator — null is tested with `{field} = null` — so it is deliberately absent. */
const OPERATOR_WORDS = [
	'and',
	'or',
	'not',
	'in',
	'like',
	'between',
	'contains',
	'as',
	'null',
	'true',
	'false',
	'asc',
	'desc',
];

/** Lowercase clause keywords the formatter breaks onto their own top-level line. */
export const CLAUSE_KEYWORDS: ReadonlySet<string> = new Set(CLAUSE_WORDS);

/** Lowercase operator/value keywords the formatter upper-cases in place. */
export const OPERATOR_KEYWORDS: ReadonlySet<string> = new Set(OPERATOR_WORDS);

/**
 * Doc metadata for a completable VQL symbol: a one-line purpose shown as the completion `detail` and
 * the earliest API version, mirroring the docs' Functions & Options reference. Kept beside the word
 * sets so completion descriptions and highlighting never drift from one another.
 */
export interface VqlSymbolDoc {
	/** One-line purpose, surfaced as the completion item's detail. */
	readonly summary: string;
	/** Earliest API version the symbol is available in (e.g. `v20.3+`). */
	readonly since: string;
}

/**
 * VQL functions keyed by upper-cased name. The tokenizer highlights these; completion offers them in
 * SELECT/WHERE/ORDER BY/FIND positions, inserted with a `(…)` call template. Summaries and versions
 * come from the docs' Functions & Options reference.
 */
export const VQL_FUNCTION_DOCS: Readonly<Record<string, VqlSymbolDoc>> = {
	TONAME: { summary: 'Document field name.', since: 'v20.3+' },
	TOLABEL: { summary: 'Object field label.', since: 'v24.1+' },
	TODISPLAYFORMAT: { summary: "Field's formatted display value.", since: 'v23.2+' },
	LONGTEXT: { summary: 'Full value of a Long Text field.', since: 'v17.1+' },
	RICHTEXT: { summary: 'Full value of a Rich Text field, including HTML.', since: 'v21.1+' },
	TRIM: { summary: 'Picklist field value without its namespace suffix.', since: 'v25.1+' },
	CASEINSENSITIVE: { summary: 'Bypass case sensitivity of fields in WHERE clauses.', since: 'v14.0+' },
	STATETYPE: { summary: 'Filter object records by state type.', since: 'v19.3+' },
	DELETEDSTATE: { summary: 'Retrieve all documents in a deleted state.', since: 'v19.2+' },
	OBSOLETESTATE: { summary: 'Retrieve all documents in an obsolete state.', since: 'v8.0+' },
	STEADYSTATE: { summary: 'Retrieve all documents in a steady state.', since: 'v8.0+' },
	SUPERSEDEDSTATE: { summary: 'Retrieve all documents in a superseded state.', since: 'v8.0+' },
	FILENAME: { summary: 'Attachment field file name.', since: 'v24.3+' },
	FILESIZE: { summary: 'Attachment field file size.', since: 'v24.3+' },
	MIMETYPE: { summary: 'Attachment field MIME type.', since: 'v24.3+' },
	MD5CHECKSUM: { summary: 'Attachment field MD5 checksum.', since: 'v24.3+' },
};

/** VQL function names, upper-cased, derived from {@link VQL_FUNCTION_DOCS} so the two never drift. */
export const VQL_FUNCTIONS = Object.keys(VQL_FUNCTION_DOCS);

/** Where a query-target option is valid: the `FROM` query-target scope or the `FIND` search string. */
export type VqlOptionContext = 'from' | 'find';

/** Doc metadata for a query-target option, extending {@link VqlSymbolDoc} with the clause it applies
 *  to so completion offers version/user options after `FROM` and search scopes after `FIND`. */
export interface VqlOptionDoc extends VqlSymbolDoc {
	readonly context: VqlOptionContext;
}

/**
 * VQL scope/version query-target options keyed by upper-cased name. `SCOPE` and its `ALL`/`CONTENT`/
 * `PROPERTIES` sub-words live here rather than with the clause keywords because the docs' Functions &
 * Options reference documents `SCOPE ALL`/`SCOPE CONTENT`/`SCOPE {fields}`/`SCOPE PROPERTIES` together
 * as its "Search Scopes" entries. `context` splits the FROM-clause options from the FIND-clause scopes.
 */
export const VQL_OPTION_DOCS: Readonly<Record<string, VqlOptionDoc>> = {
	ALLVERSIONS: { summary: 'Query all document versions.', since: 'v8.0+', context: 'from' },
	LATESTVERSION: { summary: 'Return only the latest matching document version.', since: 'v8.0+', context: 'from' },
	FAVORITES: { summary: "Only the user's favorite records.", since: 'v22.2+', context: 'from' },
	RECENT: { summary: "The user's 20 most recently viewed records.", since: 'v22.2+', context: 'from' },
	SCOPE: { summary: 'Narrow the search area.', since: 'v8.0+', context: 'find' },
	ALL: { summary: 'SCOPE ALL: search all fields and document content.', since: 'v8.0+', context: 'find' },
	CONTENT: { summary: 'SCOPE CONTENT: search document content only.', since: 'v8.0+', context: 'find' },
	PROPERTIES: { summary: 'SCOPE PROPERTIES: search String fields (default).', since: 'v8.0+', context: 'find' },
	DISTANCE: { summary: 'Fuzzy-search distance, used with SCOPE {fields}.', since: 'v26.1+', context: 'find' },
};

/** VQL option names, upper-cased, derived from {@link VQL_OPTION_DOCS} so the two never drift. Includes
 *  both FROM and FIND options — the tokenizer highlights them all; completion filters by `context`. */
export const VQL_OPTIONS = Object.keys(VQL_OPTION_DOCS);

/** Doc metadata for a relative date literal, extending {@link VqlSymbolDoc} with whether it takes a
 *  trailing `:n` integer count (the `THIS_*` and `TODAY` literals do not). */
export interface VqlDateLiteralDoc extends VqlSymbolDoc {
	/** Whether the literal takes a trailing `:n` integer count (drives the inserted snippet). */
	readonly takesCount: boolean;
}

/**
 * Relative date literals for filtering Date/DateTime fields in a WHERE clause (v24.3+). Most take an
 * integer count as a `:n` suffix (e.g. `DAYS_AGO:1`); the `TODAY`, `THIS_MONTH`, `THIS_QUARTER`, and
 * `THIS_YEAR` literals stand alone with no suffix. Only symbolic comparison
 * operators are valid with them. Completion offers these in the WHERE value position for Date and
 * DateTime fields. Kept out of {@link VQL_KEYWORDS}: they are value-position constants, not clause or
 * operator keywords, and are highlighted under their own token category.
 */
export const VQL_DATE_LITERAL_DOCS: Readonly<Record<string, VqlDateLiteralDoc>> = {
	TODAY: { summary: 'The current day, start to end of day.', since: 'v24.3+', takesCount: false },
	LAST_DAYS: { summary: 'The previous n days, including part of today.', since: 'v24.3+', takesCount: true },
	NEXT_DAYS: { summary: 'Today plus the next n days.', since: 'v24.3+', takesCount: true },
	DAYS_AGO: { summary: 'The single day n days ago (excludes today).', since: 'v24.3+', takesCount: true },
	THIS_MONTH: { summary: 'The current calendar month.', since: 'v24.3+', takesCount: false },
	LAST_MONTHS: { summary: 'The previous n months (excludes this month).', since: 'v24.3+', takesCount: true },
	NEXT_MONTHS: { summary: 'The next n months (excludes this month).', since: 'v24.3+', takesCount: true },
	MONTHS_AGO: { summary: 'The single month n months ago.', since: 'v24.3+', takesCount: true },
	THIS_QUARTER: { summary: 'The current quarter.', since: 'v24.3+', takesCount: false },
	LAST_QUARTERS: { summary: 'The previous n quarters (excludes this quarter).', since: 'v24.3+', takesCount: true },
	NEXT_QUARTERS: { summary: 'The next n quarters (excludes this quarter).', since: 'v24.3+', takesCount: true },
	QUARTERS_AGO: { summary: 'The single quarter n quarters ago.', since: 'v24.3+', takesCount: true },
	THIS_YEAR: { summary: 'The current year.', since: 'v24.3+', takesCount: false },
	LAST_YEARS: { summary: 'The previous n years (excludes this year).', since: 'v24.3+', takesCount: true },
	NEXT_YEARS: { summary: 'The next n years (excludes this year).', since: 'v24.3+', takesCount: true },
	YEARS_AGO: { summary: 'The single year n years ago.', since: 'v24.3+', takesCount: true },
};

/** Relative date-literal names, upper-cased, derived from {@link VQL_DATE_LITERAL_DOCS}. */
export const VQL_DATE_LITERALS = Object.keys(VQL_DATE_LITERAL_DOCS);

/**
 * The full keyword set for Monaco highlighting + completion — every clause and operator keyword,
 * upper-cased. Derived from the same words the formatter uses, so highlighting and formatting can
 * never disagree about what counts as a keyword.
 */
export const VQL_KEYWORDS = [
	...CLAUSE_WORDS,
	...CLAUSE_BY_WORDS,
	CLAUSE_BY_CONTINUATION,
	...CLAUSE_ONLY_WORDS,
	...OPERATOR_WORDS,
].map((word) => word.toUpperCase());

/** Clause keywords (`SELECT`, `FROM`, `ORDER BY`, `RANK`, `PAGEOFFSET`, `TARGETS`, ...) upper-cased
 *  for the Monaco tokenizer's "Clauses" highlight category. */
export const VQL_CLAUSE_KEYWORDS = [
	...CLAUSE_WORDS,
	...CLAUSE_BY_WORDS,
	CLAUSE_BY_CONTINUATION,
	...CLAUSE_ONLY_WORDS,
].map((word) => word.toUpperCase());

/** Operator/value keywords (`AND`, `LIKE`, `NULL`, ...) upper-cased for the Monaco tokenizer's
 *  "Operators" highlight category. */
export const VQL_OPERATOR_KEYWORDS = OPERATOR_WORDS.map((word) => word.toUpperCase());
