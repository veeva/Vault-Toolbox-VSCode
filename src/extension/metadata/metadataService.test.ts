import { describe, it, expect, vi } from 'vitest';
import { MetadataService } from './metadataService';
import type { VaultClient } from '../../core/rest/vaultClient';
import type { ConnectionState, RunnableConnection } from '../connection/types';

/**
 * Build a mock connection whose `run` callback receives the given partial client stub.
 * Uses `unknown` so callers can supply just the namespace sub-objects the test needs
 * (e.g. `{ vql: { showTargets } }`) without satisfying the full `VaultClient` shape.
 */
function connFor(client: unknown, state: () => ConnectionState): RunnableConnection {
	return {
		getState: state,
		run: (fn) => fn(client as VaultClient),
	};
}

const connectedTo = (vaultId?: number): ConnectionState => ({
	status: 'connected',
	info: { environment: {} as never, apiVersion: 'v26.1', latestApiVersion: 'v26.1', vaultId },
});

describe('MetadataService', () => {
	it('loads targets once and caches them', async () => {
		const showTargets = vi.fn().mockResolvedValue([{ name: 'product__v', label: 'Product' }]);
		const service = new MetadataService(connFor({ vql: { showTargets } }, () => connectedTo(1)));

		const first = await service.getTargets();
		const second = await service.getTargets();

		expect(first).toEqual([{ name: 'product__v', label: 'Product' }]);
		expect(second).toEqual(first);
		expect(showTargets).toHaveBeenCalledTimes(1);
	});

	it('de-dupes concurrent target loads into a single fetch', async () => {
		const showTargets = vi.fn().mockResolvedValue([{ name: 'product__v' }]);
		const service = new MetadataService(connFor({ vql: { showTargets } }, () => connectedTo(1)));

		await Promise.all([service.getTargets(), service.getTargets()]);

		expect(showTargets).toHaveBeenCalledTimes(1);
	});

	it("loads and caches a target's fields", async () => {
		const showFields = vi.fn().mockResolvedValue([{ name: 'name__v', type: 'String' }]);
		const service = new MetadataService(connFor({ vql: { showFields } }, () => connectedTo(1)));

		const first = await service.getFields('product__v');
		await service.getFields('product__v');

		expect(first).toEqual([{ name: 'name__v', type: 'String' }]);
		expect(showFields).toHaveBeenCalledTimes(1);
		expect(showFields).toHaveBeenCalledWith('product__v', 'toolbox-vql-editor');
	});

	it("loads and caches a target's relationships", async () => {
		const showRelationships = vi
			.fn()
			.mockResolvedValue([{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' }]);
		const service = new MetadataService(connFor({ vql: { showRelationships } }, () => connectedTo(1)));

		const first = await service.getRelationships('product__v');
		await service.getRelationships('product__v');

		expect(first).toEqual([
			{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
		]);
		expect(showRelationships).toHaveBeenCalledTimes(1);
		expect(showRelationships).toHaveBeenCalledWith('product__v', 'toolbox-vql-editor');
	});

	it('does not cache a failed SHOW RELATIONSHIPS call — a retry re-attempts', async () => {
		const showRelationships = vi
			.fn()
			.mockRejectedValueOnce(new Error('SHOW failed'))
			.mockResolvedValueOnce([{ name: 'r__cr', target: 't__c', type: 'inbound' }]);
		const service = new MetadataService(connFor({ vql: { showRelationships } }, () => connectedTo(1)));

		await expect(service.getRelationships('product__v')).rejects.toThrow('SHOW failed');
		const retried = await service.getRelationships('product__v');

		expect(retried).toEqual([{ name: 'r__cr', target: 't__c', type: 'inbound' }]);
		expect(showRelationships).toHaveBeenCalledTimes(2);
	});

	it('does not cache a failed SHOW TARGETS call — a retry re-attempts', async () => {
		const showTargets = vi
			.fn()
			.mockRejectedValueOnce(new Error('SHOW failed'))
			.mockResolvedValueOnce([{ name: 'product__v' }]);
		const service = new MetadataService(connFor({ vql: { showTargets } }, () => connectedTo(1)));

		await expect(service.getTargets()).rejects.toThrow('SHOW failed');
		const retried = await service.getTargets();

		expect(retried).toEqual([{ name: 'product__v' }]);
		expect(showTargets).toHaveBeenCalledTimes(2);
	});

	it('does not cache a failed SHOW FIELDS call — a retry re-attempts', async () => {
		const showFields = vi
			.fn()
			.mockRejectedValueOnce(new Error('SHOW failed'))
			.mockResolvedValueOnce([{ name: 'name__v', type: 'String' }]);
		const service = new MetadataService(connFor({ vql: { showFields } }, () => connectedTo(1)));

		await expect(service.getFields('product__v')).rejects.toThrow('SHOW failed');
		const retried = await service.getFields('product__v');

		expect(retried).toEqual([{ name: 'name__v', type: 'String' }]);
		expect(showFields).toHaveBeenCalledTimes(2);
	});

	it('discards targets committed for a vault that changed while the fetch was in flight', async () => {
		const resolvers: Array<(targets: unknown) => void> = [];
		const showTargets = vi
			.fn()
			.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
		let vaultId = 1;
		const service = new MetadataService(connFor({ vql: { showTargets } }, () => connectedTo(vaultId)));

		const firstCall = service.getTargets(); // fetch #1 for vault 1
		vaultId = 2; // reconnected to a different vault
		const secondCall = service.getTargets(); // fetch #2 for vault 2 (syncVault reset the cache)

		resolvers[1]([{ name: 'fresh__v' }]); // vault-2 fetch resolves first, commits
		resolvers[0]([{ name: 'stale__v' }]); // vault-1 fetch resolves late — must be discarded
		await Promise.all([firstCall, secondCall]);

		const cached = await service.getTargets();
		expect(cached).toEqual([{ name: 'fresh__v' }]);
		expect(showTargets).toHaveBeenCalledTimes(2);
	});

	it('clears the cache when the connected vault changes', async () => {
		const showTargets = vi
			.fn()
			.mockResolvedValueOnce([{ name: 'a__v' }])
			.mockResolvedValueOnce([{ name: 'b__v' }]);
		let vaultId = 1;
		const service = new MetadataService(connFor({ vql: { showTargets } }, () => connectedTo(vaultId)));

		const first = await service.getTargets();
		vaultId = 2; // reconnected to a different vault
		const second = await service.getTargets();

		expect(first).toEqual([{ name: 'a__v' }]);
		expect(second).toEqual([{ name: 'b__v' }]);
		expect(showTargets).toHaveBeenCalledTimes(2);
	});

	it('loads the configurable-object list once and caches it', async () => {
		const listConfigurableObjects = vi
			.fn()
			.mockResolvedValue([{ name: 'product__v', source: 'standard' }]);
		const service = new MetadataService(
			connFor({ metadata: { listConfigurableObjects } }, () => connectedTo(1)),
		);

		const first = await service.getConfigurableObjects();
		const second = await service.getConfigurableObjects();

		expect(first).toEqual([{ name: 'product__v', source: 'standard' }]);
		// The cached path answers from the stored name set (source is not retained in the index).
		expect(second).toEqual([{ name: 'product__v' }]);
		expect(listConfigurableObjects).toHaveBeenCalledTimes(1);
	});

	it('de-dupes concurrent configurable-object loads into a single fetch', async () => {
		const listConfigurableObjects = vi.fn().mockResolvedValue([{ name: 'product__v' }]);
		const service = new MetadataService(
			connFor({ metadata: { listConfigurableObjects } }, () => connectedTo(1)),
		);

		await Promise.all([service.getConfigurableObjects(), service.getConfigurableObjects()]);

		expect(listConfigurableObjects).toHaveBeenCalledTimes(1);
	});

	it('discards a configurable-object list committed for a vault that changed mid-fetch', async () => {
		const resolvers: Array<(objects: unknown) => void> = [];
		const listConfigurableObjects = vi
			.fn()
			.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
		let vaultId = 1;
		const service = new MetadataService(
			connFor({ metadata: { listConfigurableObjects } }, () => connectedTo(vaultId)),
		);

		const firstCall = service.getConfigurableObjects(); // fetch #1 for vault 1
		vaultId = 2; // reconnected to a different vault
		const secondCall = service.getConfigurableObjects(); // fetch #2 for vault 2

		resolvers[1]([{ name: 'fresh__v' }]); // vault-2 fetch resolves first, commits
		resolvers[0]([{ name: 'stale__v' }]); // vault-1 fetch resolves late — must be discarded
		await Promise.all([firstCall, secondCall]);

		const cached = await service.getConfigurableObjects();
		expect(cached).toEqual([{ name: 'fresh__v' }]);
		expect(listConfigurableObjects).toHaveBeenCalledTimes(2);
	});

	const productColorPicklist = [
		{
			name: 'product_color__c',
			label: 'Color',
			usedIn: [{ objectName: 'product__v', propertyName: 'color__c' }],
		},
	];

	it('builds the field→picklistName index once and projects a target slice', async () => {
		const retrieveAllPicklists = vi.fn().mockResolvedValue(productColorPicklist);
		const service = new MetadataService(
			connFor({ metadata: { retrieveAllPicklists } }, () => connectedTo(1)),
		);

		const first = await service.getPicklistFields('product__v');
		const second = await service.getPicklistFields('product__v');

		expect(first).toEqual({ color__c: 'product_color__c' });
		expect(second).toEqual(first);
		expect(retrieveAllPicklists).toHaveBeenCalledTimes(1);
	});

	it('projects an empty slice for a target with no picklist fields', async () => {
		const retrieveAllPicklists = vi.fn().mockResolvedValue(productColorPicklist);
		const service = new MetadataService(
			connFor({ metadata: { retrieveAllPicklists } }, () => connectedTo(1)),
		);

		expect(await service.getPicklistFields('country__v')).toEqual({});
	});

	it('does not cache a failed picklist-index load — a retry re-attempts', async () => {
		const retrieveAllPicklists = vi
			.fn()
			.mockRejectedValueOnce(new Error('REST failed'))
			.mockResolvedValueOnce(productColorPicklist);
		const service = new MetadataService(
			connFor({ metadata: { retrieveAllPicklists } }, () => connectedTo(1)),
		);

		await expect(service.getPicklistFields('product__v')).rejects.toThrow('REST failed');
		const retried = await service.getPicklistFields('product__v');

		expect(retried).toEqual({ color__c: 'product_color__c' });
		expect(retrieveAllPicklists).toHaveBeenCalledTimes(2);
	});

	it('pre-warms the picklist index when targets load, so a later slice needs no fetch', async () => {
		const showTargets = vi.fn().mockResolvedValue([{ name: 'product__v' }]);
		const retrieveAllPicklists = vi.fn().mockResolvedValue(productColorPicklist);
		const service = new MetadataService(
			connFor({ vql: { showTargets }, metadata: { retrieveAllPicklists } }, () => connectedTo(1)),
		);

		await service.getTargets();
		await service.getPicklistFields('product__v');

		expect(retrieveAllPicklists).toHaveBeenCalledTimes(1);
	});

	it('loads and caches a picklist\'s values lazily per name', async () => {
		const retrievePicklistValues = vi
			.fn()
			.mockResolvedValue([{ name: 'red__c', label: 'Red' }]);
		const service = new MetadataService(
			connFor({ metadata: { retrievePicklistValues } }, () => connectedTo(1)),
		);

		const first = await service.getPicklistValues('product_color__c');
		await service.getPicklistValues('product_color__c');

		expect(first).toEqual([{ name: 'red__c', label: 'Red' }]);
		expect(retrievePicklistValues).toHaveBeenCalledTimes(1);
		expect(retrievePicklistValues).toHaveBeenCalledWith('product_color__c', 'toolbox-vql-editor');
	});

	it('de-dupes concurrent value loads for the same picklist into one fetch', async () => {
		const retrievePicklistValues = vi.fn().mockResolvedValue([{ name: 'red__c', label: 'Red' }]);
		const service = new MetadataService(
			connFor({ metadata: { retrievePicklistValues } }, () => connectedTo(1)),
		);

		await Promise.all([
			service.getPicklistValues('product_color__c'),
			service.getPicklistValues('product_color__c'),
		]);

		expect(retrievePicklistValues).toHaveBeenCalledTimes(1);
	});

	it('does not cache a failed picklist-values call — a retry re-attempts', async () => {
		const retrievePicklistValues = vi
			.fn()
			.mockRejectedValueOnce(new Error('REST failed'))
			.mockResolvedValueOnce([{ name: 'red__c', label: 'Red' }]);
		const service = new MetadataService(
			connFor({ metadata: { retrievePicklistValues } }, () => connectedTo(1)),
		);

		await expect(service.getPicklistValues('product_color__c')).rejects.toThrow('REST failed');
		const retried = await service.getPicklistValues('product_color__c');

		expect(retried).toEqual([{ name: 'red__c', label: 'Red' }]);
		expect(retrievePicklistValues).toHaveBeenCalledTimes(2);
	});

	it('clears picklist caches when the connected vault changes', async () => {
		const retrieveAllPicklists = vi
			.fn()
			.mockResolvedValueOnce(productColorPicklist)
			.mockResolvedValueOnce([
				{ name: 'other__c', usedIn: [{ objectName: 'product__v', propertyName: 'size__c' }] },
			]);
		let vaultId = 1;
		const service = new MetadataService(
			connFor({ metadata: { retrieveAllPicklists } }, () => connectedTo(vaultId)),
		);

		const first = await service.getPicklistFields('product__v');
		vaultId = 2; // reconnected to a different vault
		const second = await service.getPicklistFields('product__v');

		expect(first).toEqual({ color__c: 'product_color__c' });
		expect(second).toEqual({ size__c: 'other__c' });
		expect(retrieveAllPicklists).toHaveBeenCalledTimes(2);
	});
});
