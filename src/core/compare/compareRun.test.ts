import { describe, it, expect } from 'vitest';
import {
	fetchComparison,
	summarizeCodeFetch,
	type CodeFetchResult,
	type CompareVaultPort,
} from './compareRun';
import type { CodeClass, ComponentDefinition } from './compareComponents';

/** A scriptable fake port: canned MDL/name results and a per-class source map or thrown error. */
function fakePort(
	label: string,
	config: {
		components?: ComponentDefinition[];
		codeNames?: string[];
		sources?: Record<string, string>;
		failing?: Record<string, string>;
	},
): CompareVaultPort {
	return {
		label,
		fetchComponentDefinitions: async () => config.components ?? [],
		queryCustomCodeNames: async () => config.codeNames ?? [],
		retrieveSourceCode: async (className) => {
			if (config.failing && className in config.failing) {
				throw new Error(config.failing[className]);
			}
			return config.sources?.[className] ?? '';
		},
	};
}

const notCancelled = () => false;

describe('fetchComparison', () => {
	it('fetches only MDL when code is off, one pull per Vault', async () => {
		const source = fakePort('src', { components: [{ type: 'Picklist', name: 'a__c', mdl: 'A' }] });
		const target = fakePort('tgt', { components: [] });

		const result = await fetchComparison(source, target, { mdl: true, code: false }, {
			isCancelled: notCancelled,
		});

		expect(result.kind).toBe('fetched');
		if (result.kind !== 'fetched') return;
		expect(result.data.mdl).toEqual({ source: [{ type: 'Picklist', name: 'a__c', mdl: 'A' }], target: [] });
		expect(result.data.code).toBeUndefined();
	});

	it('downloads code source from both Vaults and reports progress "N of total"', async () => {
		const source = fakePort('src', { codeNames: ['com.x.A'], sources: { 'com.x.A': 'sourceA' } });
		const target = fakePort('tgt', { codeNames: ['com.x.A', 'com.x.B'], sources: { 'com.x.A': 'tgtA', 'com.x.B': 'tgtB' } });
		const messages: string[] = [];

		const result = await fetchComparison(source, target, { mdl: false, code: true }, {
			isCancelled: notCancelled,
			onProgress: (m) => messages.push(m),
		});

		expect(result.kind).toBe('fetched');
		if (result.kind !== 'fetched') return;
		expect(result.data.code?.source).toEqual([{ name: 'com.x.A', source: 'sourceA' }]);
		expect(result.data.code?.target).toHaveLength(2);
		expect(result.data.code?.failures).toEqual([]);
		expect(messages).toContain('Downloading code 3 of 3…');
	});

	it('records a failed source GET as a failure and keeps the class as source: undefined', async () => {
		const source = fakePort('src', {
			codeNames: ['com.x.A', 'com.x.B'],
			sources: { 'com.x.A': 'sourceA' },
			failing: { 'com.x.B': 'boom' },
		});
		const target = fakePort('tgt', {});

		const result = await fetchComparison(source, target, { mdl: false, code: true }, {
			isCancelled: notCancelled,
		});

		if (result.kind !== 'fetched' || !result.data.code) throw new Error('expected code data');
		expect(result.data.code.failures).toEqual([{ className: 'com.x.B', reason: 'boom' }]);
		expect(result.data.code.source).toContainEqual({ name: 'com.x.B', source: undefined, error: 'boom' });
	});

	it('returns cancelled when cancellation is requested after the MDL phase', async () => {
		const source = fakePort('src', { components: [] });
		const target = fakePort('tgt', { components: [] });

		const result = await fetchComparison(source, target, { mdl: true, code: true }, {
			isCancelled: () => true,
		});

		expect(result.kind).toBe('cancelled');
	});
});

describe('summarizeCodeFetch', () => {
	function codeResult(overrides: Partial<CodeFetchResult>): CodeFetchResult {
		return { source: [], target: [], failures: [], ...overrides };
	}

	it('returns undefined when nothing failed', () => {
		const classes: CodeClass[] = [{ name: 'com.veeva.vault.custom.A', source: 's' }];
		expect(summarizeCodeFetch(codeResult({ source: classes }))).toBeUndefined();
	});

	it('counts distinct classes (a class on both sides is one) and lists failures with the prefix stripped', () => {
		const source: CodeClass[] = [
			{ name: 'com.veeva.vault.custom.A', source: 's' },
			{ name: 'com.veeva.vault.custom.B', source: undefined, error: 'no access' },
		];
		const target: CodeClass[] = [{ name: 'com.veeva.vault.custom.A', source: 't' }];

		const summary = summarizeCodeFetch(
			codeResult({ source, target, failures: [{ className: 'com.veeva.vault.custom.B', reason: 'no access' }] }),
		);

		expect(summary).toBe('Compared 1 of 2 (1 failed) — no access\nB');
	});
});
