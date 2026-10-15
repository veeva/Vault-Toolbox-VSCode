import { describe, it, expect, vi } from 'vitest';
import { createMetadataStore, type MetadataStore, type MetadataStoreDeps } from './metadataStore';
import { supportedQueryFilterOperators } from '../../core/vql/queryFilterOperators';
import type { ConnectionSnapshot } from '../../shared/vqlProtocol';

/** Build a store over fully-faked deps, exposing the captured connection handler so a test can drive
 *  Vault connects/switches/disconnects by hand. Any request not overridden resolves empty. */
function makeStore(overrides: Partial<MetadataStoreDeps> = {}): {
	store: MetadataStore;
	emit(state: ConnectionSnapshot): void;
} {
	let handler: ((state: ConnectionSnapshot) => void) | undefined;
	const deps: MetadataStoreDeps = {
		requestTargets: overrides.requestTargets ?? vi.fn().mockResolvedValue([]),
		requestConfigurableObjects:
			overrides.requestConfigurableObjects ?? vi.fn().mockResolvedValue([]),
		requestFields: overrides.requestFields ?? vi.fn().mockResolvedValue([]),
		requestRelationships: overrides.requestRelationships ?? vi.fn().mockResolvedValue([]),
		requestPicklistFields: overrides.requestPicklistFields ?? vi.fn().mockResolvedValue({}),
		requestPicklistValues: overrides.requestPicklistValues ?? vi.fn().mockResolvedValue([]),
		onConnectionState: (h) => {
			handler = h;
			return () => {
				handler = undefined;
			};
		},
	};
	return { store: createMetadataStore(deps), emit: (state) => handler?.(state) };
}

const connectedTo = (vaultDns: string): ConnectionSnapshot => ({
	status: 'connected',
	vaultDns,
	isProduction: false,
});

describe('MetadataStore', () => {
	it('loads targets once and caches them', async () => {
		const requestTargets = vi.fn().mockResolvedValue([{ name: 'product__v', label: 'Product' }]);
		const { store } = makeStore({ requestTargets });

		const first = await store.getTargets();
		const second = await store.getTargets();

		expect(first).toEqual([{ name: 'product__v', label: 'Product' }]);
		expect(second).toEqual(first);
		expect(requestTargets).toHaveBeenCalledTimes(1);
	});

	it('de-dupes concurrent target loads into a single fetch', async () => {
		const requestTargets = vi.fn().mockResolvedValue([{ name: 'product__v' }]);
		const { store } = makeStore({ requestTargets });

		await Promise.all([store.getTargets(), store.getTargets()]);

		expect(requestTargets).toHaveBeenCalledTimes(1);
	});

	it("loads and caches a target's fields", async () => {
		const requestFields = vi.fn().mockResolvedValue([{ name: 'name__v', type: 'String' }]);
		const { store } = makeStore({ requestFields });

		const first = await store.getFields('product__v');
		await store.getFields('product__v');

		expect(first).toEqual([{ name: 'name__v', type: 'String' }]);
		expect(requestFields).toHaveBeenCalledTimes(1);
		expect(requestFields).toHaveBeenCalledWith('product__v');
	});

	it('pre-warms SHOW TARGETS when a Vault connects', async () => {
		const requestTargets = vi.fn().mockResolvedValue([{ name: 'product__v' }]);
		const { store, emit } = makeStore({ requestTargets });

		emit(connectedTo('vault-one.veevavault.com'));
		await store.getTargets();

		expect(requestTargets).toHaveBeenCalledTimes(1);
	});

	it('clears the cache and re-fetches when the connected Vault changes', async () => {
		const requestTargets = vi
			.fn()
			.mockResolvedValueOnce([{ name: 'a__v' }])
			.mockResolvedValueOnce([{ name: 'b__v' }]);
		const { store, emit } = makeStore({ requestTargets });

		emit(connectedTo('vault-one.veevavault.com'));
		const first = await store.getTargets();
		emit(connectedTo('vault-two.veevavault.com'));
		const second = await store.getTargets();

		expect(first).toEqual([{ name: 'a__v' }]);
		expect(second).toEqual([{ name: 'b__v' }]);
		expect(requestTargets).toHaveBeenCalledTimes(2);
	});

	it('clears the cache on a mid-session disconnect (see docs/defects/query-builder-target-selectable-after-disconnect.md)', async () => {
		const requestTargets = vi
			.fn()
			.mockResolvedValueOnce([{ name: 'a__v' }])
			.mockResolvedValueOnce([{ name: 'a__v' }]);
		const { store, emit } = makeStore({ requestTargets });

		emit(connectedTo('vault-one.veevavault.com'));
		await store.getTargets();
		emit({ status: 'disconnected', isProduction: false });

		// Nothing pickable survives the drop — the loaded target list is gone, not just hidden.
		expect(store.getSnapshot().targetsStatus()).toBe('idle');
		expect(store.getSnapshot().index.objectSummaries()).toEqual([]);

		const after = await store.getTargets();
		expect(after).toEqual([{ name: 'a__v' }]);
		expect(requestTargets).toHaveBeenCalledTimes(2);
	});

	it('re-fetches fresh on a reconnect to the same Vault after a disconnect', async () => {
		const requestTargets = vi
			.fn()
			.mockResolvedValueOnce([{ name: 'a__v' }])
			.mockResolvedValueOnce([{ name: 'a__v' }]);
		const { store, emit } = makeStore({ requestTargets });

		emit(connectedTo('vault-one.veevavault.com'));
		await store.getTargets();
		emit({ status: 'disconnected', isProduction: false });
		emit(connectedTo('vault-one.veevavault.com'));
		await store.getTargets();

		expect(requestTargets).toHaveBeenCalledTimes(2);
	});

	it('is a no-op when the active-environment pointer re-reports the same live connection', async () => {
		const requestTargets = vi.fn().mockResolvedValue([{ name: 'a__v' }]);
		const { store, emit } = makeStore({ requestTargets });

		emit(connectedTo('vault-one.veevavault.com'));
		await store.getTargets();
		emit(connectedTo('vault-one.veevavault.com')); // no disconnect in between — still the same Vault
		await store.getTargets();

		expect(requestTargets).toHaveBeenCalledTimes(1);
	});

	it('discards a target fetch that was still in flight when the Vault disconnected', async () => {
		const resolvers: Array<(targets: unknown) => void> = [];
		const requestTargets = vi
			.fn()
			.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
		const { store, emit } = makeStore({ requestTargets });

		emit(connectedTo('vault-one.veevavault.com')); // pre-warm fetch #1
		const inFlight = store.getTargets();
		emit({ status: 'disconnected', isProduction: false }); // resets before the response lands

		resolvers[0]([{ name: 'stale__v' }]); // settles late — must not repopulate the cleared cache
		await inFlight;

		expect(store.getSnapshot().index.objectSummaries()).toEqual([]);
		expect(store.getSnapshot().targetsStatus()).toBe('idle');
	});

	it('pre-warms the configurable-object list on connect and reflects it in the snapshot', async () => {
		const requestConfigurableObjects = vi
			.fn()
			.mockResolvedValue([{ name: 'product__v', source: 'standard' }]);
		const { store, emit } = makeStore({ requestConfigurableObjects });

		emit(connectedTo('vault-one.veevavault.com'));
		await store.getConfigurableObjects();

		expect(requestConfigurableObjects).toHaveBeenCalledTimes(1);
		const snap = store.getSnapshot();
		expect(snap.configurableObjectsStatus()).toBe('loaded');
		expect(snap.isConfigurableObject('product__v')).toBe(true);
		// A queryable-but-non-configurable target is not a member, so it will resolve dynamic.
		expect(snap.isConfigurableObject('job_instance__sys')).toBe(false);
	});

	it('caches the configurable-object list and re-fetches only on a Vault change', async () => {
		const requestConfigurableObjects = vi
			.fn()
			.mockResolvedValueOnce([{ name: 'a__v' }])
			.mockResolvedValueOnce([{ name: 'b__v' }]);
		const { store, emit } = makeStore({ requestConfigurableObjects });

		emit(connectedTo('vault-one.veevavault.com'));
		const first = await store.getConfigurableObjects();
		await store.getConfigurableObjects(); // cached — no second fetch
		emit(connectedTo('vault-two.veevavault.com'));
		const second = await store.getConfigurableObjects();

		expect(first).toEqual([{ name: 'a__v' }]);
		expect(second).toEqual([{ name: 'b__v' }]);
		expect(requestConfigurableObjects).toHaveBeenCalledTimes(2);
		expect(store.getSnapshot().isConfigurableObject('a__v')).toBe(false);
		expect(store.getSnapshot().isConfigurableObject('b__v')).toBe(true);
	});

	it('discards targets committed for a Vault that changed while the fetch was in flight', async () => {
		const resolvers: Array<(targets: unknown) => void> = [];
		const requestTargets = vi
			.fn()
			.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
		const { store, emit } = makeStore({ requestTargets });

		emit(connectedTo('vault-one.veevavault.com')); // pre-warm fetch #1 for Vault one
		const firstCall = store.getTargets();
		emit(connectedTo('vault-two.veevavault.com')); // reset + pre-warm fetch #2 for Vault two
		const secondCall = store.getTargets();

		resolvers[1]([{ name: 'fresh__v' }]); // Vault-two fetch resolves first, commits
		resolvers[0]([{ name: 'stale__v' }]); // Vault-one fetch resolves late — must be discarded
		await Promise.all([firstCall, secondCall]);

		const cached = await store.getTargets();
		expect(cached).toEqual([{ name: 'fresh__v' }]);
		expect(requestTargets).toHaveBeenCalledTimes(2);
	});

	it('keeps de-duping the new Vault fetch after a stale in-flight request settles late', async () => {
		const resolvers: Array<(targets: unknown) => void> = [];
		const requestTargets = vi
			.fn()
			.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
		const { store, emit } = makeStore({ requestTargets });

		emit(connectedTo('vault-one.veevavault.com')); // pre-warm fetch #1 for Vault one
		const firstCall = store.getTargets();
		emit(connectedTo('vault-two.veevavault.com')); // reset + pre-warm fetch #2 for Vault two

		resolvers[0]([{ name: 'stale__v' }]); // Vault-one fetch settles late
		await firstCall; // its `.finally` has now run — it must not have evicted fetch #2

		// Fetch #2 is still in flight, so a concurrent demand de-dupes to it rather than firing a third.
		const concurrent = store.getTargets();
		resolvers[1]([{ name: 'fresh__v' }]);
		await concurrent;

		expect(requestTargets).toHaveBeenCalledTimes(2);
		expect(await store.getTargets()).toEqual([{ name: 'fresh__v' }]);
	});

	describe('resolved field-type getters', () => {
		const requestFields = () =>
			vi.fn().mockResolvedValue([
				{ name: 'name__v', type: 'String' },
				{ name: 'color__c', type: 'String' }, // reported String, but it is a picklist
				{ name: 'active__c', type: 'Boolean' },
			]);
		const requestPicklistFields = () =>
			vi.fn().mockResolvedValue({ color__c: 'product_color__c' });

		it('resolves a picklist field to Picklist regardless of its raw SHOW type', async () => {
			const { store } = makeStore({
				requestFields: requestFields(),
				requestPicklistFields: requestPicklistFields(),
			});

			expect(await store.getFieldType('product__v', 'color__c')).toBe('Picklist');
			expect(await store.isPicklist('product__v', 'color__c')).toBe(true);
		});

		it('resolves a non-picklist field to its raw token, and an unknown field to undefined', async () => {
			const { store } = makeStore({
				requestFields: requestFields(),
				requestPicklistFields: requestPicklistFields(),
			});

			expect(await store.getFieldType('product__v', 'name__v')).toBe('String');
			expect(await store.getFieldType('product__v', 'missing__c')).toBeUndefined();
			expect(await store.isPicklist('product__v', 'name__v')).toBe(false);
		});

		it('returns the operator row for each resolved type', async () => {
			const { store } = makeStore({
				requestFields: requestFields(),
				requestPicklistFields: requestPicklistFields(),
			});

			expect(await store.getOperatorsFor('product__v', 'color__c')).toEqual(
				supportedQueryFilterOperators.Picklist,
			);
			expect(await store.getOperatorsFor('product__v', 'name__v')).toEqual(
				supportedQueryFilterOperators.String,
			);
			expect(await store.getOperatorsFor('product__v', 'missing__c')).toEqual(
				supportedQueryFilterOperators.Default,
			);
		});
	});

	describe('failure asymmetry', () => {
		it('surfaces an error status when SHOW TARGETS fails', async () => {
			const requestTargets = vi.fn().mockRejectedValue(new Error('boom'));
			const { store } = makeStore({ requestTargets });

			await expect(store.getTargets()).rejects.toThrow('boom');
			expect(store.getSnapshot().targetsStatus()).toBe('error');
		});

		it('surfaces an error status when SHOW FIELDS fails', async () => {
			const requestFields = vi.fn().mockRejectedValue(new Error('boom'));
			const { store } = makeStore({ requestFields });

			await expect(store.getFields('product__v')).rejects.toThrow('boom');
			expect(store.getSnapshot().fieldsStatus('product__v')).toBe('error');
		});

		it('degrades relationships to empty with no error status on failure', async () => {
			const requestRelationships = vi.fn().mockRejectedValue(new Error('boom'));
			const { store } = makeStore({ requestRelationships });

			await expect(store.getRelationships('product__v')).resolves.toEqual([]);
			expect(store.getSnapshot().relationshipsStatus('product__v')).toBe('idle');
		});

		it('degrades picklist fields to empty with no error status on failure', async () => {
			const requestPicklistFields = vi.fn().mockRejectedValue(new Error('boom'));
			const { store } = makeStore({ requestPicklistFields });

			await expect(store.getPicklistFields('product__v')).resolves.toEqual({});
			expect(store.getSnapshot().picklistFieldsStatus('product__v')).toBe('idle');
		});

		it('degrades picklist values to empty with no error status on failure', async () => {
			const requestPicklistValues = vi.fn().mockRejectedValue(new Error('boom'));
			const { store } = makeStore({ requestPicklistValues });

			await expect(store.getPicklistValues('product_color__c')).resolves.toEqual([]);
			expect(store.getSnapshot().picklistValuesStatus('product_color__c')).toBe('idle');
		});

		it('re-attempts a failed relationships load rather than caching the empty result', async () => {
			const requestRelationships = vi
				.fn()
				.mockRejectedValueOnce(new Error('boom'))
				.mockResolvedValueOnce([{ name: 'r__cr', target: 't__c', type: 'inbound' }]);
			const { store } = makeStore({ requestRelationships });

			await store.getRelationships('product__v');
			const retried = await store.getRelationships('product__v');

			expect(retried).toEqual([{ name: 'r__cr', target: 't__c', type: 'inbound' }]);
			expect(requestRelationships).toHaveBeenCalledTimes(2);
		});
	});

	describe('picklist values', () => {
		it('de-dupes concurrent value loads for the same picklist into one fetch', async () => {
			const requestPicklistValues = vi.fn().mockResolvedValue([{ name: 'red__c', label: 'Red' }]);
			const { store } = makeStore({ requestPicklistValues });

			await Promise.all([
				store.getPicklistValues('product_color__c'),
				store.getPicklistValues('product_color__c'),
			]);

			expect(requestPicklistValues).toHaveBeenCalledTimes(1);
		});
	});

	describe('subscribe / getSnapshot', () => {
		it('notifies subscribers on change and returns a stable snapshot when unchanged', async () => {
			const requestTargets = vi.fn().mockResolvedValue([{ name: 'a__v' }]);
			const { store } = makeStore({ requestTargets });
			const before = store.getSnapshot();
			const listener = vi.fn();
			store.subscribe(listener);

			await store.getTargets();

			expect(listener).toHaveBeenCalled();
			const after = store.getSnapshot();
			expect(after).not.toBe(before);
			expect(store.getSnapshot()).toBe(after);
		});
	});
});
