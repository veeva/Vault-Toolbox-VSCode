import { describe, it, expect } from 'vitest';
import { MetadataIndex } from './metadataIndex';

describe('MetadataIndex', () => {
	it('starts empty', () => {
		expect(MetadataIndex.EMPTY.objectNames()).toEqual([]);
		expect(MetadataIndex.EMPTY.fieldsLoaded('product__v')).toBe(false);
		expect(MetadataIndex.EMPTY.fieldsFor('product__v')).toEqual([]);
		expect(MetadataIndex.EMPTY.configurableObjectsLoaded()).toBe(false);
		expect(MetadataIndex.EMPTY.isConfigurableObject('product__v')).toBe(false);
		expect(MetadataIndex.EMPTY.configurableObjectNames()).toEqual([]);
	});

	it('records the configurable-object set and distinguishes loaded-empty from not-yet-loaded', () => {
		const index = MetadataIndex.EMPTY.withConfigurableObjects(['product__v', 'user__sys']);
		expect(index.configurableObjectsLoaded()).toBe(true);
		expect(index.isConfigurableObject('product__v')).toBe(true);
		expect(index.isConfigurableObject('user__sys')).toBe(true);
		// A queryable-but-non-configurable target (in SHOW TARGETS, not a vobject) is not a member.
		expect(index.isConfigurableObject('job_instance__sys')).toBe(false);
		expect([...index.configurableObjectNames()].sort()).toEqual(['product__v', 'user__sys']);

		// Loaded-empty reads as loaded (so callers stop treating targets as maybe-configurable), while the
		// untouched EMPTY reads as not-yet-loaded — the safe default that classifies everything dynamic.
		const loadedEmpty = MetadataIndex.EMPTY.withConfigurableObjects([]);
		expect(loadedEmpty.configurableObjectsLoaded()).toBe(true);
		expect(loadedEmpty.isConfigurableObject('product__v')).toBe(false);
		expect(MetadataIndex.EMPTY.configurableObjectsLoaded()).toBe(false);
	});

	it('records object names/summaries in order without mutating the source', () => {
		const index = MetadataIndex.EMPTY.withObjects([
			{ name: 'product__v', label: 'Product' },
			{ name: 'country__v', label: 'Country' },
		]);
		expect(index.objectNames()).toEqual(['product__v', 'country__v']);
		expect(index.objectSummaries()[0]).toEqual({ name: 'product__v', label: 'Product' });
		// EMPTY is untouched (immutability)
		expect(MetadataIndex.EMPTY.objectNames()).toEqual([]);
	});

	it('distinguishes loaded-empty fields from not-yet-loaded', () => {
		const withFields = MetadataIndex.EMPTY.withFields('product__v', [{ name: 'id', type: 'ID' }]);
		expect(withFields.fieldsLoaded('product__v')).toBe(true);
		expect(withFields.fieldsFor('product__v')).toEqual([{ name: 'id', type: 'ID' }]);

		const loadedEmpty = MetadataIndex.EMPTY.withFields('empty__v', []);
		expect(loadedEmpty.fieldsLoaded('empty__v')).toBe(true);
		expect(loadedEmpty.fieldsFor('empty__v')).toEqual([]);
		expect(loadedEmpty.fieldsLoaded('other__v')).toBe(false);
	});

	it('preserves object list when adding fields and vice versa', () => {
		const index = MetadataIndex.EMPTY.withObjects([{ name: 'product__v' }]).withFields(
			'product__v',
			[{ name: 'name__v' }],
		);
		expect(index.objectNames()).toEqual(['product__v']);
		expect(index.fieldsFor('product__v')).toEqual([{ name: 'name__v' }]);
	});

	it('distinguishes loaded-empty relationships from not-yet-loaded', () => {
		const withRels = MetadataIndex.EMPTY.withRelationships('product__v', [
			{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
		]);
		expect(withRels.relationshipsLoaded('product__v')).toBe(true);
		expect(withRels.relationshipsFor('product__v')).toEqual([
			{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
		]);

		const loadedEmpty = MetadataIndex.EMPTY.withRelationships('empty__v', []);
		expect(loadedEmpty.relationshipsLoaded('empty__v')).toBe(true);
		expect(loadedEmpty.relationshipsFor('empty__v')).toEqual([]);
		expect(loadedEmpty.relationshipsLoaded('other__v')).toBe(false);
	});

	it('keeps field and relationship slices independent across withFields/withRelationships', () => {
		const index = MetadataIndex.EMPTY.withFields('product__v', [{ name: 'name__v' }])
			.withRelationships('product__v', [
				{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
			]);
		expect(index.fieldsFor('product__v')).toEqual([{ name: 'name__v' }]);
		expect(index.relationshipsFor('product__v')).toEqual([
			{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
		]);
		expect(index.relationshipsLoaded('product__v')).toBe(true);
		expect(index.fieldsLoaded('product__v')).toBe(true);
	});
});
