import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
	{
		ignores: ['dist/**', 'node_modules/**'],
	},
	js.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: 'module',
		},
		plugins: {
			'@typescript-eslint': tsPlugin,
		},
		rules: {
			...tsPlugin.configs.recommended.rules,
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			// Use the TS-aware rule: it understands the value+type namespace merge
			// (e.g. `const AuthType` alongside `type AuthType`).
			'no-redeclare': 'off',
			'@typescript-eslint/no-redeclare': 'error',
			// TypeScript already resolves identifiers (incl. Node/global built-ins like fetch, URL,
			// setTimeout); the core `no-undef` rule only produces false positives on TS.
			'no-undef': 'off',
		},
	},
];
