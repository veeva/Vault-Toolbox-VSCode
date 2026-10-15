import { describe, it, expect, vi } from 'vitest';

// compareController imports vscode at module load; stub it so the module loads in the node test env.
vi.mock('vscode', () => ({}));

import { buildConventionPick, buildBatchSummary } from './compareController';
import { prepareBatch } from '../../core/compare/compareApply';
import type { CompareEntry, NamingConvention } from '../../core/compare/compareComponents';

const CONVENTIONS: NamingConvention[] = ['all', 'custom', 'standard', 'system', 'other'];

describe('buildConventionPick', () => {
	it('pre-selects the current filter rather than defaulting to the top "All" row', () => {
		const { items, activeItem } = buildConventionPick('standard');
		expect(activeItem?.value).toBe('standard');
		expect(activeItem).not.toBe(items[0]);
	});

	it('pre-selects the matching item for every convention, including "all" (the top row)', () => {
		for (const convention of CONVENTIONS) {
			const { activeItem } = buildConventionPick(convention);
			expect(activeItem?.value).toBe(convention);
		}
	});

	it('tags exactly the active item with the "current filter" description', () => {
		const { items, activeItem } = buildConventionPick('custom');
		const taggedItems = items.filter((item) => item.description === 'current filter');
		expect(taggedItems).toEqual([activeItem]);
	});

	it('offers the choices in display order with "All" first', () => {
		const { items } = buildConventionPick('all');
		expect(items.map((item) => item.value)).toEqual(CONVENTIONS);
	});
});

// Helpers for batch tests
function mdlEntry(type: string, name: string, status: CompareEntry['status'], sourceMdl?: string): CompareEntry {
	return { kind: 'mdl', type, name, status, sourceMdl };
}
function codeEntry(name: string, status: CompareEntry['status'], sourceMdl?: string): CompareEntry {
	return { kind: 'code', type: '', name, status, sourceMdl };
}

// `prepareBatch` itself is exercised in `src/core/compare/compareApply.test.ts`; here it only feeds
// the `buildBatchSummary` dialog-copy cases below.

describe('buildBatchSummary', () => {
	it('titles with count and target DNS', () => {
		const batch = prepareBatch([mdlEntry('Picklist', 'size__c', 'modified', 'RECREATE Picklist size__c();')]);
		const { title } = buildBatchSummary(batch, 'dev.veevavault.com');
		expect(title).toBe('Apply 1 change to dev.veevavault.com');
	});

	it('pluralises correctly for multiple changes', () => {
		const entries: CompareEntry[] = [
			mdlEntry('Picklist', 'a__c', 'modified', 'RECREATE Picklist a__c();'),
			mdlEntry('Picklist', 'b__c', 'source-only', 'RECREATE Picklist b__c();'),
		];
		const { title } = buildBatchSummary(prepareBatch(entries), 'dev.veevavault.com');
		expect(title).toBe('Apply 2 changes to dev.veevavault.com');
	});

	it('places drops after creates/updates within the MDL section', () => {
		const entries: CompareEntry[] = [
			mdlEntry('Picklist', 'keep__c', 'modified', 'RECREATE Picklist keep__c();'),
			mdlEntry('Picklist', 'drop__c', 'target-only'),
		];
		const { detail } = buildBatchSummary(prepareBatch(entries), 'dev.veevavault.com');
		const updateLine = detail.indexOf('Updates');
		const dropLine = detail.indexOf('Drops');
		expect(updateLine).toBeGreaterThanOrEqual(0);
		expect(dropLine).toBeGreaterThanOrEqual(0);
		expect(updateLine).toBeLessThan(dropLine);
	});

	it('summarises MDL creates, updates, and drops by count under Components (MDL)', () => {
		const entries: CompareEntry[] = [
			mdlEntry('Picklist', 'new__c', 'source-only', 'RECREATE Picklist new__c();'),
			mdlEntry('Picklist', 'mod__c', 'modified', 'RECREATE Picklist mod__c();'),
			mdlEntry('Picklist', 'old__c', 'target-only'),
		];
		const { detail } = buildBatchSummary(prepareBatch(entries), 'dev.veevavault.com');
		expect(detail).toContain('Components:');
		expect(detail).toContain('Creates: 1');
		expect(detail).toContain('Updates: 1');
		expect(detail).toContain('Drops: 1');
		expect(detail).not.toContain('new__c');
	});

	it('summarises Java SDK creates, updates, and deletes by count under Code (Vault Java SDK)', () => {
		const entries: CompareEntry[] = [
			codeEntry('com.example.New', 'source-only', 'class New {}'),
			codeEntry('com.example.Mod', 'modified', 'class Mod {}'),
			codeEntry('com.example.Old', 'target-only'),
		];
		const { detail } = buildBatchSummary(prepareBatch(entries), 'dev.veevavault.com');
		expect(detail).toContain('Code:');
		expect(detail).toContain('Creates: 1');
		expect(detail).toContain('Updates: 1');
		expect(detail).toContain('Deletes: 1');
		expect(detail).not.toContain('com.example');
	});
});
