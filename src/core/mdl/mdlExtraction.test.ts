import { describe, it, expect } from 'vitest';
import type { QueryRow } from '../rest/types';
import { orphanedMdlFiles, planMdlFiles, relativeMdlPath } from './mdlExtraction';

function row(fields: Record<string, unknown>): QueryRow {
	return fields;
}

describe('planMdlFiles', () => {
	it('maps a component row to a Type/Type.name.mdl file with the MDL as content', () => {
		const files = planMdlFiles([
			row({
				component_type__v: 'Picklist',
				component_name__v: 'color__c',
				mdl_definition__v: 'RECREATE Picklist color__c ();',
			}),
		]);

		expect(files).toEqual([
			{ segments: ['Picklist', 'Picklist.color__c.mdl'], content: 'RECREATE Picklist color__c ();' },
		]);
	});

	it("skips rows whose mdl_definition__v is 'N/A'", () => {
		const files = planMdlFiles([
			row({ component_type__v: 'Doctype', component_name__v: 'x__c', mdl_definition__v: 'N/A' }),
		]);

		expect(files).toEqual([]);
	});

	it('skips rows missing the type, name, or definition', () => {
		const files = planMdlFiles([
			row({ component_name__v: 'x__c', mdl_definition__v: 'MDL' }),
			row({ component_type__v: 'Picklist', mdl_definition__v: 'MDL' }),
			row({ component_type__v: 'Picklist', component_name__v: 'x__c' }),
		]);

		expect(files).toEqual([]);
	});
});

describe('relativeMdlPath', () => {
	it('joins the segments with a forward slash regardless of platform', () => {
		expect(relativeMdlPath({ segments: ['Picklist', 'Picklist.color__c.mdl'], content: '' })).toBe(
			'Picklist/Picklist.color__c.mdl',
		);
	});
});

describe('orphanedMdlFiles', () => {
	it('returns existing paths that were not written in this extraction', () => {
		const orphans = orphanedMdlFiles(
			['Picklist/Picklist.a__c.mdl', 'Picklist/Picklist.gone__c.mdl'],
			['Picklist/Picklist.a__c.mdl'],
		);

		expect(orphans).toEqual(['Picklist/Picklist.gone__c.mdl']);
	});

	it('returns nothing when every existing file was written', () => {
		expect(orphanedMdlFiles(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
	});

	it('returns nothing when there were no existing files', () => {
		expect(orphanedMdlFiles([], ['a'])).toEqual([]);
	});
});
