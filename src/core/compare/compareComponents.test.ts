import { describe, it, expect } from 'vitest';
import {
	compareCodeSets,
	compareComponentSets,
	deriveApplyPlan,
	namingConventionOf,
	selectVisibleEntries,
	type CodeClass,
	type ComponentDefinition,
	type CompareEntry,
} from './compareComponents';

function makeComponent(type: string, name: string, mdl: string): ComponentDefinition {
	return { type, name, mdl };
}

function codeByName(entries: CompareEntry[]): Record<string, CompareEntry> {
	return Object.fromEntries(entries.map((entry) => [entry.name, entry]));
}

function entriesByName(entries: CompareEntry[]): Record<string, CompareEntry> {
	return Object.fromEntries(entries.map((entry) => [`${entry.type}.${entry.name}`, entry]));
}

describe('compareComponentSets', () => {
	it('derives a status for every case', () => {
		const source = [
			makeComponent('Picklist', 'color__c', 'RECREATE Picklist color__c (label(\'Color\'));'),
			makeComponent('Picklist', 'size__c', 'RECREATE Picklist size__c (label(\'Size\'));'),
			makeComponent('Object', 'only_source__c', 'RECREATE Object only_source__c ();'),
		];
		const target = [
			// identical to source
			makeComponent('Picklist', 'color__c', 'RECREATE Picklist color__c (label(\'Color\'));'),
			// modified vs source
			makeComponent('Picklist', 'size__c', 'RECREATE Picklist size__c (label(\'Sizes\'));'),
			// target only
			makeComponent('Object', 'only_target__c', 'RECREATE Object only_target__c ();'),
		];

		const byName = entriesByName(compareComponentSets(source, target));

		expect(byName['Picklist.color__c'].status).toBe('identical');
		expect(byName['Picklist.size__c'].status).toBe('modified');
		expect(byName['Object.only_source__c'].status).toBe('source-only');
		expect(byName['Object.only_target__c'].status).toBe('target-only');
	});

	it('treats byte-equal MDL as identical and any difference as modified (equality boundary)', () => {
		const identical = entriesByName(
			compareComponentSets([makeComponent('Picklist', 'a__c', 'X')], [makeComponent('Picklist', 'a__c', 'X')]),
		);
		expect(identical['Picklist.a__c'].status).toBe('identical');

		const trailingWhitespace = entriesByName(
			compareComponentSets([makeComponent('Picklist', 'a__c', 'X')], [makeComponent('Picklist', 'a__c', 'X ')]),
		);
		expect(trailingWhitespace['Picklist.a__c'].status).toBe('modified');
	});

	it('keeps same name under different types distinct', () => {
		const entries = compareComponentSets(
			[makeComponent('Picklist', 'shared__c', 'P'), makeComponent('Object', 'shared__c', 'O')],
			[makeComponent('Picklist', 'shared__c', 'P')],
		);
		const byName = entriesByName(entries);
		expect(byName['Picklist.shared__c'].status).toBe('identical');
		expect(byName['Object.shared__c'].status).toBe('source-only');
	});

	it('carries source and target MDL onto each entry (empty side omitted)', () => {
		const byName = entriesByName(
			compareComponentSets(
				[makeComponent('Picklist', 'src__c', 'S'), makeComponent('Picklist', 'both__c', 'A')],
				[makeComponent('Picklist', 'tgt__c', 'T'), makeComponent('Picklist', 'both__c', 'B')],
			),
		);
		expect(byName['Picklist.src__c'].sourceMdl).toBe('S');
		expect(byName['Picklist.src__c'].targetMdl).toBeUndefined();
		expect(byName['Picklist.tgt__c'].sourceMdl).toBeUndefined();
		expect(byName['Picklist.tgt__c'].targetMdl).toBe('T');
		expect(byName['Picklist.both__c']).toMatchObject({ sourceMdl: 'A', targetMdl: 'B' });
	});

	it('returns no entries when both sides are empty', () => {
		expect(compareComponentSets([], [])).toEqual([]);
	});

	it('sorts entries by type then name', () => {
		const entries = compareComponentSets(
			[makeComponent('Picklist', 'b__c', 'x'), makeComponent('Object', 'z__c', 'x'), makeComponent('Object', 'a__c', 'x')],
			[],
		);
		expect(entries.map((e) => `${e.type}.${e.name}`)).toEqual([
			'Object.a__c',
			'Object.z__c',
			'Picklist.b__c',
		]);
	});

	it('stamps every entry with kind "mdl"', () => {
		const entries = compareComponentSets(
			[makeComponent('Picklist', 'a__c', 'X')],
			[makeComponent('Object', 'b__c', 'Y')],
		);
		expect(entries.every((e) => e.kind === 'mdl')).toBe(true);
	});
});

function makeCodeClass(name: string, source?: string, error?: string): CodeClass {
	return { name, source, error };
}

describe('compareCodeSets', () => {
	it('derives Source Only / Target Only / Modified / Identical by byte-equality of source', () => {
		const source = [
			makeCodeClass('com.veeva.vault.custom.Same', 'class Same {}'),
			makeCodeClass('com.veeva.vault.custom.Changed', 'class Changed { int a; }'),
			makeCodeClass('com.veeva.vault.custom.OnlySource', 'class OnlySource {}'),
		];
		const target = [
			makeCodeClass('com.veeva.vault.custom.Same', 'class Same {}'),
			makeCodeClass('com.veeva.vault.custom.Changed', 'class Changed { int b; }'),
			makeCodeClass('com.veeva.vault.custom.OnlyTarget', 'class OnlyTarget {}'),
		];

		const byName = codeByName(compareCodeSets(source, target));

		expect(byName['com.veeva.vault.custom.Same'].status).toBe('identical');
		expect(byName['com.veeva.vault.custom.Changed'].status).toBe('modified');
		expect(byName['com.veeva.vault.custom.OnlySource'].status).toBe('source-only');
		expect(byName['com.veeva.vault.custom.OnlyTarget'].status).toBe('target-only');
	});

	it('treats byte-equal source as identical and any difference as modified (equality boundary)', () => {
		const identical = codeByName(
			compareCodeSets([makeCodeClass('a.B', 'X')], [makeCodeClass('a.B', 'X')]),
		);
		expect(identical['a.B'].status).toBe('identical');

		const trailingWhitespace = codeByName(
			compareCodeSets([makeCodeClass('a.B', 'X')], [makeCodeClass('a.B', 'X ')]),
		);
		expect(trailingWhitespace['a.B'].status).toBe('modified');
	});

	it('classifies a class present on both sides but missing source as unavailable, never modified/identical', () => {
		const missingSourceSide = codeByName(
			compareCodeSets([makeCodeClass('a.B', undefined)], [makeCodeClass('a.B', 'X')]),
		);
		expect(missingSourceSide['a.B'].status).toBe('unavailable');

		const missingTargetSide = codeByName(
			compareCodeSets([makeCodeClass('a.B', 'X')], [makeCodeClass('a.B', undefined)]),
		);
		expect(missingTargetSide['a.B'].status).toBe('unavailable');
	});

	it('classifies a source-only class whose source is missing as unavailable', () => {
		const byName = codeByName(compareCodeSets([makeCodeClass('a.B', undefined)], []));
		expect(byName['a.B'].status).toBe('unavailable');
	});

	it('classifies a target-only class whose source is missing as unavailable, same as source-only', () => {
		const byName = codeByName(compareCodeSets([], [makeCodeClass('a.B', undefined)]));
		expect(byName['a.B'].status).toBe('unavailable');
	});

	it('keeps a target-only class classifiable when its source was actually fetched', () => {
		const byName = codeByName(compareCodeSets([], [makeCodeClass('a.B', 'X')]));
		expect(byName['a.B'].status).toBe('target-only');
	});

	it('carries the fetch-failure reason through to the entry, per side', () => {
		const bothMissing = codeByName(
			compareCodeSets(
				[makeCodeClass('a.B', undefined, 'source boom')],
				[makeCodeClass('a.B', undefined, 'target boom')],
			),
		);
		expect(bothMissing['a.B']).toMatchObject({
			status: 'unavailable',
			sourceError: 'source boom',
			targetError: 'target boom',
		});

		const sourceOnlyMissing = codeByName(
			compareCodeSets([makeCodeClass('a.B', undefined, 'source boom')], []),
		);
		expect(sourceOnlyMissing['a.B']).toMatchObject({ status: 'unavailable', sourceError: 'source boom' });

		const targetOnlyMissing = codeByName(
			compareCodeSets([], [makeCodeClass('a.B', undefined, 'target boom')]),
		);
		expect(targetOnlyMissing['a.B']).toMatchObject({ status: 'unavailable', targetError: 'target boom' });
	});

	it('keys entries by fully-qualified class name and stamps kind "code"', () => {
		const entries = compareCodeSets([makeCodeClass('com.veeva.vault.custom.Trigger', 'X')], []);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: 'code', name: 'com.veeva.vault.custom.Trigger' });
	});

	it('deduplicates identical fully-qualified class names across sides into one entry', () => {
		const entries = compareCodeSets(
			[makeCodeClass('a.Dup', 'S')],
			[makeCodeClass('a.Dup', 'T')],
		);
		expect(entries.map((e) => e.name)).toEqual(['a.Dup']);
	});

	it('carries source and target text onto each entry (empty side omitted)', () => {
		const byName = codeByName(
			compareCodeSets(
				[makeCodeClass('a.Src', 'S'), makeCodeClass('a.Both', 'A')],
				[makeCodeClass('a.Tgt', 'T'), makeCodeClass('a.Both', 'B')],
			),
		);
		expect(byName['a.Src'].sourceMdl).toBe('S');
		expect(byName['a.Src'].targetMdl).toBeUndefined();
		expect(byName['a.Tgt'].sourceMdl).toBeUndefined();
		expect(byName['a.Tgt'].targetMdl).toBe('T');
		expect(byName['a.Both']).toMatchObject({ sourceMdl: 'A', targetMdl: 'B' });
	});

	it('returns no entries when both sides are empty', () => {
		expect(compareCodeSets([], [])).toEqual([]);
	});

	it('sorts entries by class name', () => {
		const entries = compareCodeSets(
			[makeCodeClass('a.Zebra', 'x'), makeCodeClass('a.Apple', 'x'), makeCodeClass('a.Mango', 'x')],
			[],
		);
		expect(entries.map((e) => e.name)).toEqual(['a.Apple', 'a.Mango', 'a.Zebra']);
	});
});

describe('namingConventionOf', () => {
	it('classifies by suffix', () => {
		expect(namingConventionOf('color__c')).toBe('custom');
		expect(namingConventionOf('name__v')).toBe('standard');
		expect(namingConventionOf('merge_fields__sys')).toBe('system');
		expect(namingConventionOf('legacy_name')).toBe('other');
	});

	it('treats null/empty names as other', () => {
		expect(namingConventionOf(undefined)).toBe('other');
		expect(namingConventionOf(null)).toBe('other');
		expect(namingConventionOf('')).toBe('other');
	});
});

describe('selectVisibleEntries', () => {
	const entries: CompareEntry[] = [
		{ kind: 'mdl', type: 'Picklist', name: 'color__c', status: 'modified', sourceMdl: 'a', targetMdl: 'b' },
		{ kind: 'mdl', type: 'Picklist', name: 'name__v', status: 'source-only', sourceMdl: 'a' },
		{ kind: 'mdl', type: 'Object', name: 'audit__sys', status: 'identical', sourceMdl: 'a', targetMdl: 'a' },
		{ kind: 'mdl', type: 'Object', name: 'legacy', status: 'target-only', targetMdl: 'b' },
	];

	it('returns nothing for an empty entry list', () => {
		expect(selectVisibleEntries([], { showIdentical: true, convention: 'all', search: '' })).toEqual(
			[],
		);
	});

	it('hides identical entries by default and reveals them when toggled on', () => {
		const hidden = selectVisibleEntries(entries, {
			showIdentical: false,
			convention: 'all',
			search: '',
		});
		expect(hidden.some((e) => e.status === 'identical')).toBe(false);

		const shown = selectVisibleEntries(entries, {
			showIdentical: true,
			convention: 'all',
			search: '',
		});
		expect(shown.some((e) => e.status === 'identical')).toBe(true);
	});

	it('filters by naming convention', () => {
		const custom = selectVisibleEntries(entries, {
			showIdentical: true,
			convention: 'custom',
			search: '',
		});
		expect(custom.map((e) => e.name)).toEqual(['color__c']);

		const system = selectVisibleEntries(entries, {
			showIdentical: true,
			convention: 'system',
			search: '',
		});
		expect(system.map((e) => e.name)).toEqual(['audit__sys']);
	});

	it('filters by name search, case-insensitively', () => {
		const found = selectVisibleEntries(entries, {
			showIdentical: true,
			convention: 'all',
			search: 'COLOR',
		});
		expect(found.map((e) => e.name)).toEqual(['color__c']);
	});

	it('composes toggle, convention, and search together', () => {
		// custom filter + identicals shown + search that matches an identical of another convention:
		// the convention filter still wins, so nothing matches.
		const result = selectVisibleEntries(entries, {
			showIdentical: true,
			convention: 'custom',
			search: 'audit',
		});
		expect(result).toEqual([]);
	});
});

describe('selectVisibleEntries with code entries', () => {
	const mixed: CompareEntry[] = [
		{ kind: 'mdl', type: 'Picklist', name: 'color__c', status: 'modified', sourceMdl: 'a', targetMdl: 'b' },
		{ kind: 'mdl', type: 'Picklist', name: 'name__v', status: 'source-only', sourceMdl: 'a' },
		{ kind: 'code', type: '', name: 'com.veeva.vault.custom.Trigger', status: 'modified', sourceMdl: 'a', targetMdl: 'b' },
		{ kind: 'code', type: '', name: 'com.veeva.vault.custom.Action', status: 'unavailable', sourceMdl: 'a' },
	];

	it('retains code entries regardless of the convention filter (Filter Components by Source is MDL-only)', () => {
		// A custom-code class name carries no __c/__v/__sys suffix, so a convention filter would drop it
		// if it applied — it must not.
		for (const convention of ['custom', 'standard', 'system', 'other'] as const) {
			const visible = selectVisibleEntries(mixed, {
				showIdentical: true,
				convention,
				search: '',
			});
			expect(visible.filter((e) => e.kind === 'code').map((e) => e.name).sort()).toEqual([
				'com.veeva.vault.custom.Action',
				'com.veeva.vault.custom.Trigger',
			]);
		}
	});

	it('narrows only mdl entries by convention while code stays', () => {
		const custom = selectVisibleEntries(mixed, { showIdentical: true, convention: 'custom', search: '' });
		expect(custom.filter((e) => e.kind === 'mdl').map((e) => e.name)).toEqual(['color__c']);
	});

	it('matches code entries by class name in the name search', () => {
		const found = selectVisibleEntries(mixed, {
			showIdentical: true,
			convention: 'all',
			search: 'trigger',
		});
		expect(found.map((e) => e.name)).toEqual(['com.veeva.vault.custom.Trigger']);
	});

	it('hides identical code entries by default and never hides unavailable ones', () => {
		const withIdentical: CompareEntry[] = [
			{ kind: 'code', type: '', name: 'a.Same', status: 'identical', sourceMdl: 'x', targetMdl: 'x' },
			{ kind: 'code', type: '', name: 'a.Gone', status: 'unavailable', sourceMdl: 'x' },
		];
		const visible = selectVisibleEntries(withIdentical, {
			showIdentical: false,
			convention: 'all',
			search: '',
		});
		expect(visible.map((e) => e.name)).toEqual(['a.Gone']);
	});
});

describe('deriveApplyPlan for mdl entries', () => {
	it('executes the source definition verbatim for a source-only component', () => {
		const plan = deriveApplyPlan({
			kind: 'mdl',
			type: 'Object',
			name: 'new__c',
			status: 'source-only',
			sourceMdl: 'RECREATE Object new__c ();',
		});
		expect(plan).toEqual({ operation: 'execute', script: 'RECREATE Object new__c ();' });
	});

	it('executes the source definition verbatim for a modified component', () => {
		const plan = deriveApplyPlan({
			kind: 'mdl',
			type: 'Picklist',
			name: 'color__c',
			status: 'modified',
			sourceMdl: "RECREATE Picklist color__c (label('Color'));",
			targetMdl: "RECREATE Picklist color__c (label('Colour'));",
		});
		expect(plan).toEqual({
			operation: 'execute',
			script: "RECREATE Picklist color__c (label('Color'));",
		});
	});

	it('drops a target-only component with an exact DROP statement', () => {
		const plan = deriveApplyPlan({
			kind: 'mdl',
			type: 'Picklist',
			name: 'obsolete__c',
			status: 'target-only',
			targetMdl: 'RECREATE Picklist obsolete__c ();',
		});
		expect(plan).toEqual({ operation: 'drop', script: 'DROP Picklist obsolete__c;' });
	});

	it('offers no apply for an identical component', () => {
		const plan = deriveApplyPlan({
			kind: 'mdl',
			type: 'Picklist',
			name: 'same__c',
			status: 'identical',
			sourceMdl: 'X',
			targetMdl: 'X',
		});
		expect(plan).toBeNull();
	});
});

describe('deriveApplyPlan for code entries', () => {
	it('deploys the source text for a source-only class', () => {
		const plan = deriveApplyPlan({
			kind: 'code',
			type: '',
			name: 'com.veeva.vault.custom.New',
			status: 'source-only',
			sourceMdl: 'class New {}',
		});
		expect(plan).toEqual({
			operation: 'deploy',
			className: 'com.veeva.vault.custom.New',
			source: 'class New {}',
		});
	});

	it('deploys the source text for a modified class', () => {
		const plan = deriveApplyPlan({
			kind: 'code',
			type: '',
			name: 'com.veeva.vault.custom.Changed',
			status: 'modified',
			sourceMdl: 'class Changed { int a; }',
			targetMdl: 'class Changed { int b; }',
		});
		expect(plan).toEqual({
			operation: 'deploy',
			className: 'com.veeva.vault.custom.Changed',
			source: 'class Changed { int a; }',
		});
	});

	it('deletes a target-only class by fully-qualified class name', () => {
		const plan = deriveApplyPlan({
			kind: 'code',
			type: '',
			name: 'com.veeva.vault.custom.Obsolete',
			status: 'target-only',
			targetMdl: 'class Obsolete {}',
		});
		expect(plan).toEqual({ operation: 'delete', className: 'com.veeva.vault.custom.Obsolete' });
	});

	it('offers no apply for an identical class', () => {
		const plan = deriveApplyPlan({
			kind: 'code',
			type: '',
			name: 'com.veeva.vault.custom.Same',
			status: 'identical',
			sourceMdl: 'X',
			targetMdl: 'X',
		});
		expect(plan).toBeNull();
	});

	it('offers no apply for an unavailable class (source could not be retrieved)', () => {
		const plan = deriveApplyPlan({
			kind: 'code',
			type: '',
			name: 'com.veeva.vault.custom.Gone',
			status: 'unavailable',
			targetMdl: 'X',
		});
		expect(plan).toBeNull();
	});
});
