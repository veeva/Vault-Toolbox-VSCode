import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import {
	VQL_CLAUSE_KEYWORDS,
	VQL_DATE_LITERALS,
	VQL_FUNCTIONS,
	VQL_OPERATOR_KEYWORDS,
	VQL_OPTIONS,
} from '../../core/vql/vqlKeywords';

/**
 * VQL Monarch language + themes for the VQL Editor. The keyword/function/option grammar lives in the
 * portable `core/vql/vqlKeywords` (the single source of truth shared with the formatter); this file
 * owns only the Monaco-specific tokenizer, language configuration, and themes.
 */

export const VQL_LANGUAGE_ID = 'vql';

const richLanguageConfiguration: monaco.languages.LanguageConfiguration = {
	brackets: [
		['{', '}'],
		['[', ']'],
		['(', ')'],
	],
	autoClosingPairs: [
		{ open: '{', close: '}' },
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: '"', close: '"' },
		{ open: "'", close: "'" },
	],
	surroundingPairs: [
		{ open: '{', close: '}' },
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: '"', close: '"' },
		{ open: "'", close: "'" },
	],
};

const vqlLanguage: monaco.languages.IMonarchLanguage = {
	defaultToken: '',
	ignoreCase: true,
	brackets: [{ open: '(', close: ')', token: 'delimiter.parenthesis' }],
	clauseKeywords: VQL_CLAUSE_KEYWORDS,
	operatorKeywords: VQL_OPERATOR_KEYWORDS,
	functions: VQL_FUNCTIONS,
	options: VQL_OPTIONS,
	dateLiterals: VQL_DATE_LITERALS,
	tokenizer: {
		root: [
			[
				/[a-zA-Z_$][\w$]*/,
				{
					cases: {
						'@functions': 'entity.vql.functionOption',
						'@options': 'entity.vql.functionOption',
						'@dateLiterals': 'constant.vql.dateLiteral',
						'@clauseKeywords': 'keyword.vql.clause',
						'@operatorKeywords': 'keyword.vql.operator',
						'@default': 'identifier',
					},
				},
			],
			{ include: '@whitespace' },
			[/\d+(\.\d+)?/, 'number'],
			[/'([^'\\]|\\.)*'/, 'string'],
			[/"([^"\\]|\\.)*"/, 'string'],
			[/[(),.]/, 'delimiter'],
			[/[=<>!]+|[-+*/]/, 'keyword.vql.operator'],
		],
		whitespace: [[/[ \t\r\n]+/, '']],
	},
};

// Three color groups, matching how the VQL documentation itself is organized: Clauses, Operators
// (logical keywords like AND/LIKE and comparison symbols like =/!=/< share one color), and
// Functions & Options (VQL_FUNCTIONS and VQL_OPTIONS, documented together as one reference page,
// share the other). Strings, numbers, and relative date literals get their own literal-value colors.
// The function/option color is tuned per theme (a muted magenta, not neon) so it stays legible on
// both surfaces. Base vs/vs-dark; we don't override editor.background so the editor uses Monaco's
// stock surface.
const SHARED_TOKEN_RULES: monaco.editor.ITokenThemeRule[] = [{ token: 'string', foreground: '6AA84F' }];

const lightTheme: monaco.editor.IStandaloneThemeData = {
	base: 'vs',
	inherit: true,
	rules: [
		{ token: 'keyword.vql.clause', foreground: '0000FF', fontStyle: 'bold' },
		{ token: 'keyword.vql.operator', foreground: 'AF00DB' },
		{ token: 'entity.vql.functionOption', foreground: 'A626A4' },
		{ token: 'number', foreground: '098658' },
		{ token: 'constant.vql.dateLiteral', foreground: '267F99' },
		...SHARED_TOKEN_RULES,
	],
	colors: {},
};

const darkTheme: monaco.editor.IStandaloneThemeData = {
	base: 'vs-dark',
	inherit: true,
	rules: [
		{ token: 'keyword.vql.clause', foreground: '449FD7', fontStyle: 'bold' },
		{ token: 'keyword.vql.operator', foreground: 'C586C0' },
		{ token: 'entity.vql.functionOption', foreground: 'C97BC4' },
		{ token: 'number', foreground: 'B5CEA8' },
		{ token: 'constant.vql.dateLiteral', foreground: '4EC9B0' },
		...SHARED_TOKEN_RULES,
	],
	colors: {},
};

export const VQL_THEME_LIGHT = 'vql-light';
export const VQL_THEME_DARK = 'vql-dark';

let registered = false;

/** Register the VQL language, tokenizer, config, and themes once per webview load. */
export function registerVqlLanguage(): void {
	if (registered) {
		return;
	}
	registered = true;
	monaco.languages.register({ id: VQL_LANGUAGE_ID });
	monaco.languages.setMonarchTokensProvider(VQL_LANGUAGE_ID, vqlLanguage);
	monaco.languages.setLanguageConfiguration(VQL_LANGUAGE_ID, richLanguageConfiguration);
	monaco.editor.defineTheme(VQL_THEME_LIGHT, lightTheme);
	monaco.editor.defineTheme(VQL_THEME_DARK, darkTheme);
}
