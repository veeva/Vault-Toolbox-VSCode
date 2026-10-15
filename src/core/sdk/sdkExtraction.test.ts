import { describe, it, expect } from 'vitest';
import type { QueryRow } from '../rest/types';
import {
	customClassDisplayName,
	customCodeClassNames,
	orphanedSdkFiles,
	sdkExtractionSummary,
	sourceFileSegments,
} from './sdkExtraction';

function row(fields: Record<string, unknown>): QueryRow {
	return fields;
}

describe('sourceFileSegments', () => {
	it('splits a fully-qualified class name into package segments with a .java leaf', () => {
		expect(sourceFileSegments('com.veeva.vault.custom.triggers.HelloWorld')).toEqual([
			'com',
			'veeva',
			'vault',
			'custom',
			'triggers',
			'HelloWorld.java',
		]);
	});
});

describe('customCodeClassNames', () => {
	it('returns each row’s non-empty component_name__v', () => {
		const names = customCodeClassNames([
			row({ component_name__v: 'com.veeva.vault.custom.triggers.A' }),
			row({ component_name__v: 'com.veeva.vault.custom.actions.B' }),
		]);

		expect(names).toEqual([
			'com.veeva.vault.custom.triggers.A',
			'com.veeva.vault.custom.actions.B',
		]);
	});

	it('skips rows missing the field or carrying a blank / non-string value', () => {
		const names = customCodeClassNames([
			row({}),
			row({ component_name__v: '' }),
			row({ component_name__v: 42 }),
			row({ component_name__v: 'com.veeva.vault.custom.triggers.Kept' }),
		]);

		expect(names).toEqual(['com.veeva.vault.custom.triggers.Kept']);
	});
});

describe('customClassDisplayName', () => {
	it('strips the shared com.veeva.vault.custom. prefix, keeping the sub-package path', () => {
		expect(customClassDisplayName('com.veeva.vault.custom.actions.vSDKCrosslinkDocumentAction')).toBe(
			'actions.vSDKCrosslinkDocumentAction',
		);
	});

	it('returns a name without the prefix unchanged', () => {
		expect(customClassDisplayName('com.veeva.vault.services.Other')).toBe(
			'com.veeva.vault.services.Other',
		);
	});
});

describe('orphanedSdkFiles', () => {
	it('returns a .java file whose class is absent from the queried name set', () => {
		const orphans = orphanedSdkFiles(
			['com/veeva/vault/custom/triggers/Gone.java', 'com/veeva/vault/custom/triggers/Kept.java'],
			['com.veeva.vault.custom.triggers.Kept'],
		);

		expect(orphans).toEqual(['com/veeva/vault/custom/triggers/Gone.java']);
	});

	it('preserves a class in the queried set that failed to download this run (ADR 0009)', () => {
		// The class still exists in Vault (it is in the queried set) but its source was not written this
		// run — computing orphans against the queried set, not the written set, keeps its local file.
		const orphans = orphanedSdkFiles(
			['com/veeva/vault/custom/triggers/Failed.java'],
			['com.veeva.vault.custom.triggers.Failed'],
		);

		expect(orphans).toEqual([]);
	});

	it('never returns non-.java files, even when unrelated to any queried class', () => {
		const orphans = orphanedSdkFiles(
			['README.md', 'com/veeva/vault/custom/notes.txt', 'com/veeva/vault/custom/triggers/Gone.java'],
			[],
		);

		expect(orphans).toEqual(['com/veeva/vault/custom/triggers/Gone.java']);
	});
});

describe('sdkExtractionSummary', () => {
	it('reports how many of how many landed and surfaces the one failed class name', () => {
		const message = sdkExtractionSummary(2, [
			{ className: 'com.veeva.vault.custom.triggers.Boom', reason: 'HTTP 404' },
		]);

		expect(message).toBe(
			'Extracted 2 of 3 (1 failed). Couldn’t download com.veeva.vault.custom.triggers.Boom: HTTP 404',
		);
	});

	it('lists every failed class name and the first failure’s reason', () => {
		const message = sdkExtractionSummary(1, [
			{ className: 'com.veeva.vault.custom.triggers.A', reason: 'HTTP 500' },
			{ className: 'com.veeva.vault.custom.actions.B', reason: 'HTTP 404' },
		]);

		expect(message).toBe(
			'Extracted 1 of 3 (2 failed). Couldn’t download com.veeva.vault.custom.triggers.A, com.veeva.vault.custom.actions.B: HTTP 500',
		);
	});
});
