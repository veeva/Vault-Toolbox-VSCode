import { describe, it, expect } from 'vitest';
import type { ComponentDefinition } from '../../core/compare/compareComponents';
import { CompareSession, type ComparePeer } from './compareSession';

function peer(label: string): ComparePeer {
	return { envId: `${label}-id`, vaultDNS: `${label}.veevavault.com`, label };
}

function component(type: string, name: string, mdl: string): ComponentDefinition {
	return { type, name, mdl };
}

/**
 * A session with one identical, one modified, and one source-only component — enough to exercise the
 * view filters and the difference count. `targetIsProduction` defaults to a safe (non-prod) sandbox.
 */
function makeSession(targetIsProduction = false): CompareSession {
	return new CompareSession({
		source: peer('sandbox'),
		target: peer('target'),
		targetIsProduction,
		mdl: {
			source: [
				component('Picklist', 'color__c', 'SAME'),
				component('Picklist', 'size__c', 'SOURCE'),
				component('Object', 'only_source__c', 'X'),
			],
			target: [
				component('Picklist', 'color__c', 'SAME'),
				component('Picklist', 'size__c', 'TARGET'),
			],
		},
	});
}

describe('CompareSession view state', () => {
	it('defaults to hiding identical entries, no filter, no search', () => {
		const session = makeSession();
		expect(session.showIdentical).toBe(false);
		expect(session.convention).toBe('all');
		expect(session.search).toBe('');
	});

	it('toggleIdentical flips the flag and surfaces the identical entry', () => {
		const session = makeSession();
		const names = () => session.visibleEntries().map((entry) => entry.name);
		expect(names()).not.toContain('color__c');

		session.toggleIdentical();
		expect(session.showIdentical).toBe(true);
		expect(names()).toContain('color__c');

		session.toggleIdentical();
		expect(session.showIdentical).toBe(false);
	});

	it('setSearch narrows the visible entries by name', () => {
		const session = makeSession();
		session.setSearch('size');
		expect(session.search).toBe('size');
		expect(session.visibleEntries().map((entry) => entry.name)).toEqual(['size__c']);
	});

	it('searchActive tracks whether the query is non-empty', () => {
		const session = makeSession();
		expect(session.searchActive).toBe(false);

		session.setSearch('size');
		expect(session.searchActive).toBe(true);

		session.setSearch('');
		expect(session.searchActive).toBe(false);
	});

	it('filterActive is false only for the all convention', () => {
		const session = makeSession();
		expect(session.filterActive).toBe(false);

		session.setConvention('custom');
		expect(session.filterActive).toBe(true);

		session.setConvention('all');
		expect(session.filterActive).toBe(false);
	});
});

describe('CompareSession apply-enabled guard', () => {
	it('enables apply on a non-production target', () => {
		const session = makeSession(false);
		expect(session.applyEnabled).toBe(false);
		session.setApplyEnabled(true);
		expect(session.applyEnabled).toBe(true);
		session.setApplyEnabled(false);
		expect(session.applyEnabled).toBe(false);
	});

	it('refuses to enable apply on a production target (coerced to false)', () => {
		const session = makeSession(true);
		session.setApplyEnabled(true);
		expect(session.applyEnabled).toBe(false);
	});
});

describe('CompareSession change events', () => {
	it('fires onDidChange for view and apply-enabled mutations', () => {
		const session = makeSession();
		let fired = 0;
		session.onDidChange(() => (fired += 1));

		session.toggleIdentical();
		session.setSearch('color');
		session.setConvention('custom');
		session.setApplyEnabled(true);

		expect(fired).toBe(4);
	});

	it('suppresses no-op mutations', () => {
		const session = makeSession();
		let fired = 0;
		session.onDidChange(() => (fired += 1));

		session.setSearch(''); // already empty
		session.setConvention('all'); // already the default
		session.setApplyEnabled(false); // already disabled

		expect(fired).toBe(0);
	});

	it('does not fire after unsubscribe', () => {
		const session = makeSession();
		let fired = 0;
		const unsubscribe = session.onDidChange(() => (fired += 1));

		session.toggleIdentical();
		unsubscribe();
		session.toggleIdentical();

		expect(fired).toBe(1);
	});

	it('leaves entry mutations silent (recompute drives its own refresh)', () => {
		const session = makeSession();
		let fired = 0;
		session.onDidChange(() => (fired += 1));

		session.replaceEntry({ kind: 'mdl', type: 'Picklist', name: 'size__c', status: 'identical', sourceMdl: 'SAME', targetMdl: 'SAME' });
		session.removeEntry('Object', 'only_source__c');

		expect(fired).toBe(0);
	});
});

describe('CompareSession applicableDifferenceCount', () => {
	it('counts every non-identical, non-unavailable entry across both kinds', () => {
		const session = new CompareSession({
			source: peer('sandbox'),
			target: peer('target'),
			targetIsProduction: false,
			mdl: {
				source: [
					component('Picklist', 'color__c', 'SAME'), // identical — excluded
					component('Picklist', 'size__c', 'SOURCE'), // modified — counted
				],
				target: [component('Picklist', 'color__c', 'SAME'), component('Picklist', 'size__c', 'TARGET')],
			},
			code: {
				source: [
					{ name: 'com.veeva.vault.custom.A', source: 'a' }, // source-only — counted
					{ name: 'com.veeva.vault.custom.B', source: undefined }, // both sides, source missing → unavailable — excluded
				],
				target: [{ name: 'com.veeva.vault.custom.B', source: 'b' }],
			},
		});

		// size__c (modified) + A (source-only) = 2; color__c identical and B unavailable are excluded.
		expect(session.applicableDifferenceCount).toBe(2);
	});

	it('is zero when the only differences are unavailable code classes', () => {
		const session = new CompareSession({
			source: peer('sandbox'),
			target: peer('target'),
			targetIsProduction: false,
			code: {
				source: [{ name: 'com.veeva.vault.custom.B', source: undefined }],
				target: [{ name: 'com.veeva.vault.custom.B', source: 'b' }],
			},
		});
		expect(session.differenceCount).toBe(1); // the unavailable class differs…
		expect(session.applicableDifferenceCount).toBe(0); // …but nothing can be applied.
	});
});

describe('CompareSession entry mutations', () => {
	it('replaceEntry updates status and differenceCount', () => {
		const session = makeSession();
		expect(session.differenceCount).toBe(2); // size__c modified + only_source__c source-only

		session.replaceEntry({ kind: 'mdl', type: 'Picklist', name: 'size__c', status: 'identical', sourceMdl: 'SAME', targetMdl: 'SAME' });
		expect(session.differenceCount).toBe(1);
		expect(session.getEntry('Picklist', 'size__c')?.status).toBe('identical');
	});

	it('removeEntry drops an entry entirely', () => {
		const session = makeSession();
		session.removeEntry('Object', 'only_source__c');
		expect(session.getEntry('Object', 'only_source__c')).toBeUndefined();
		expect(session.differenceCount).toBe(1);
	});
});

describe('CompareSession checkbox selection', () => {
	it('starts with no entries checked', () => {
		const session = makeSession();
		expect(session.selectionCount).toBe(0);
		expect(session.checkedEntries()).toHaveLength(0);
	});

	it('setChecked marks an entry and isChecked reflects it', () => {
		const session = makeSession();
		const entry = session.getEntry('Picklist', 'size__c')!;
		session.setChecked(entry, true);
		expect(session.isChecked(entry)).toBe(true);
		expect(session.selectionCount).toBe(1);
	});

	it('setChecked(false) unmarks an entry', () => {
		const session = makeSession();
		const entry = session.getEntry('Picklist', 'size__c')!;
		session.setChecked(entry, true);
		session.setChecked(entry, false);
		expect(session.isChecked(entry)).toBe(false);
		expect(session.selectionCount).toBe(0);
	});

	it('checkedEntries returns all checked entries', () => {
		const session = makeSession();
		const size = session.getEntry('Picklist', 'size__c')!;
		const source = session.getEntry('Object', 'only_source__c')!;
		session.setChecked(size, true);
		session.setChecked(source, true);
		const names = session.checkedEntries().map((e) => e.name);
		expect(names).toContain('size__c');
		expect(names).toContain('only_source__c');
		expect(session.selectionCount).toBe(2);
	});

	it('fires onDidChange when checked state changes', () => {
		const session = makeSession();
		let fired = 0;
		session.onDidChange(() => (fired += 1));
		const entry = session.getEntry('Picklist', 'size__c')!;
		session.setChecked(entry, true);
		session.setChecked(entry, false);
		expect(fired).toBe(2);
	});

	it('suppresses no-op check mutations', () => {
		const session = makeSession();
		let fired = 0;
		session.onDidChange(() => (fired += 1));
		const entry = session.getEntry('Picklist', 'size__c')!;
		session.setChecked(entry, false); // already unchecked
		session.setChecked(entry, true);
		session.setChecked(entry, true); // already checked
		expect(fired).toBe(1);
	});

	it('replaceEntry removes checked key when entry becomes identical', () => {
		const session = makeSession();
		const entry = session.getEntry('Picklist', 'size__c')!;
		session.setChecked(entry, true);
		expect(session.selectionCount).toBe(1);

		session.replaceEntry({ kind: 'mdl', type: 'Picklist', name: 'size__c', status: 'identical', sourceMdl: 'X', targetMdl: 'X' });
		expect(session.selectionCount).toBe(0);
	});

	it('removeEntry removes the checked key', () => {
		const session = makeSession();
		const entry = session.getEntry('Object', 'only_source__c')!;
		session.setChecked(entry, true);
		expect(session.selectionCount).toBe(1);

		session.removeEntry('Object', 'only_source__c');
		expect(session.selectionCount).toBe(0);
	});
});
