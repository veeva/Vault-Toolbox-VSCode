import type {
	VaultFieldMeta,
	VaultObjectMetadataSummary,
	VaultObjectSummary,
	VaultPicklistValue,
	VaultRelationshipMeta,
} from '../../core/rest/types';
import type { ConnectionSnapshot } from '../../shared/vqlProtocol';
import { MetadataIndex } from '../../core/vql/metadataIndex';
import { resolveFieldType, type MetadataLoadStatus } from '../../core/vql/builderPanelState';
import {
	type FilterOperator,
	operatorsForFieldType,
} from '../../core/vql/queryFilterOperators';

/**
 * The webview's read model of Vault metadata — the mirror image of the host `MetadataService`. A
 * single framework-free store owns every metadata concern on the webview side: fetching the five
 * `SHOW`/picklist resources over the `vql` channel, caching them, de-duping in-flight requests,
 * resetting on a Vault change, and answering the resolved "what's this field's type / operators" join
 * once. Both consumers — the React `QueryBuilder` and the Monaco `vqlCompletion` provider — become
 * thin readers over this interface, so the orchestration has one home and one test surface.
 *
 * It is framework-free by necessity, not just for testing: one of its two consumers is a Monaco
 * `CompletionItemProvider` that is never a React component, so the shared orchestration cannot live in
 * a hook. Data is held in the core {@link MetadataIndex} (reused verbatim, swapped immutably); the
 * per-resource load lifecycle is a parallel status layer the snapshot exposes alongside it.
 */

/** The metadata request functions and connection stream the store orchestrates, injected so the store
 *  body never imports `vqlClient` directly and tests can drive it with fakes. */
export interface MetadataStoreDeps {
	requestTargets(): Promise<VaultObjectSummary[]>;
	requestConfigurableObjects(): Promise<VaultObjectMetadataSummary[]>;
	requestFields(target: string): Promise<VaultFieldMeta[]>;
	requestRelationships(target: string): Promise<VaultRelationshipMeta[]>;
	requestPicklistFields(target: string): Promise<Record<string, string>>;
	requestPicklistValues(picklist: string): Promise<VaultPicklistValue[]>;
	onConnectionState(handler: (state: ConnectionSnapshot) => void): () => void;
}

/**
 * An immutable read view of the store's current state: the {@link MetadataIndex} for data, the
 * per-resource load lifecycle, and the resolved field-type join. `getSnapshot` returns a stable
 * reference until something changes, so it drives `useSyncExternalStore` directly.
 */
export interface MetadataSnapshot {
	/** The metadata data view (objects, fields, relationships, picklists). */
	readonly index: MetadataIndex;
	targetsStatus(): MetadataLoadStatus;
	configurableObjectsStatus(): MetadataLoadStatus;
	/** Whether `name` is a real configurable object (present in `GET /metadata/vobjects`). `false` until
	 *  the list lands — the safe default, so an unverified target is never treated as a real object. */
	isConfigurableObject(name: string): boolean;
	fieldsStatus(target: string): MetadataLoadStatus;
	relationshipsStatus(target: string): MetadataLoadStatus;
	picklistFieldsStatus(target: string): MetadataLoadStatus;
	picklistValuesStatus(picklist: string): MetadataLoadStatus;
	/** A field's effective type ("picklist index outranks the SHOW type"; unknown → `undefined`). */
	getFieldType(target: string, field: string): string | undefined;
	/** The filter operators valid for a field's resolved type. */
	getOperatorsFor(target: string, field: string): readonly FilterOperator[];
	/** Whether a field is a picklist (presence in the picklist index is authoritative). */
	isPicklist(target: string, field: string): boolean;
	/** A picklist field's loaded values, or `undefined` when the field is not a picklist or its values
	 *  have not loaded yet (the caller triggers the lazy load via {@link MetadataStore.getPicklistValues}). */
	picklistValuesForField(target: string, field: string): readonly VaultPicklistValue[] | undefined;
}

export interface MetadataStore {
	subscribe(listener: () => void): () => void;
	getSnapshot(): MetadataSnapshot;
	getTargets(): Promise<readonly VaultObjectSummary[]>;
	getConfigurableObjects(): Promise<readonly VaultObjectMetadataSummary[]>;
	getFields(target: string): Promise<readonly VaultFieldMeta[]>;
	getRelationships(target: string): Promise<readonly VaultRelationshipMeta[]>;
	getPicklistFields(target: string): Promise<Record<string, string>>;
	getPicklistValues(picklist: string): Promise<readonly VaultPicklistValue[]>;
	getFieldType(target: string, field: string): Promise<string | undefined>;
	getOperatorsFor(target: string, field: string): Promise<readonly FilterOperator[]>;
	isPicklist(target: string, field: string): Promise<boolean>;
	dispose(): void;
}

const TARGETS_KEY = 'targets';
const CONFIGURABLE_OBJECTS_KEY = 'configurableObjects';
const fieldsKey = (target: string): string => `fields:${target}`;
const relationshipsKey = (target: string): string => `rel:${target}`;
const picklistFieldsKey = (target: string): string => `plf:${target}`;
const picklistValuesKey = (picklist: string): string => `plv:${picklist}`;

/** One keyed, de-duped, stale-vault-guarded lazy load — the shared shape behind every async getter
 *  (mirrors the host `MetadataService.loadKeyed`). `soft` resources degrade to `empty` on failure with
 *  no `error` status; hard resources surface `error` and re-throw. */
interface KeyedLoad<T> {
	key: string;
	soft: boolean;
	isLoaded(): boolean;
	cached(): T;
	empty: T;
	fetch(): Promise<T>;
	store(data: T): void;
}

/** A field's effective type, resolved off a specific index snapshot (the join core `resolveFieldType`
 *  performs — picklist index outranks the raw SHOW type). */
function fieldTypeFrom(index: MetadataIndex, target: string, field: string): string | undefined {
	return resolveFieldType(index.fieldsFor(target), index.picklistFieldsFor(target), field);
}

/**
 * Create a metadata store bound to the injected {@link MetadataStoreDeps}. The app wires one singleton
 * (see `metadataStoreSingleton.ts`); tests build their own instance with fakes.
 */
export function createMetadataStore(deps: MetadataStoreDeps): MetadataStore {
	let index = MetadataIndex.EMPTY;
	const status = new Map<string, MetadataLoadStatus>();
	const inFlight = new Map<string, Promise<unknown>>();
	// The webview loads picklist fields per target (the host projects a slice per call), but the core
	// index holds a vault-wide reverse-map — so accumulate loaded targets and rebuild the index's map.
	const picklistFieldsByTarget = new Map<string, ReadonlyMap<string, string>>();
	// Bumped on every Vault reset; a fetch that began under an earlier generation is discarded so a
	// stale callback can't poison the freshly-reset index (mirrors the host's `fetchedForVaultId` guard).
	let generation = 0;
	// The Vault whose metadata is currently loaded, or `undefined` once disconnected. Any change —
	// including a disconnect, or a reconnect to the *same* Vault after one — resets: a dropped connection
	// must never leave a stale target/field list pickable (see
	// `docs/defects/query-builder-target-selectable-after-disconnect.md`), so nothing survives a
	// disconnect for the cache to "reconnect into."
	let loadedVaultDns: string | undefined;
	const listeners = new Set<() => void>();

	function statusOf(key: string): MetadataLoadStatus {
		return status.get(key) ?? 'idle';
	}

	function buildSnapshot(): MetadataSnapshot {
		const current = index;
		const statusMap = new Map(status);
		const read = (key: string): MetadataLoadStatus => statusMap.get(key) ?? 'idle';
		return {
			index: current,
			targetsStatus: () => read(TARGETS_KEY),
			configurableObjectsStatus: () => read(CONFIGURABLE_OBJECTS_KEY),
			isConfigurableObject: (name) => current.isConfigurableObject(name),
			fieldsStatus: (target) => read(fieldsKey(target)),
			relationshipsStatus: (target) => read(relationshipsKey(target)),
			picklistFieldsStatus: (target) => read(picklistFieldsKey(target)),
			picklistValuesStatus: (picklist) => read(picklistValuesKey(picklist)),
			getFieldType: (target, field) => fieldTypeFrom(current, target, field),
			getOperatorsFor: (target, field) =>
				operatorsForFieldType(fieldTypeFrom(current, target, field)),
			isPicklist: (target, field) => Boolean(current.picklistNameFor(target, field)),
			picklistValuesForField: (target, field) => {
				const name = current.picklistNameFor(target, field);
				return name && current.picklistValuesLoaded(name)
					? current.picklistValuesFor(name)
					: undefined;
			},
		};
	}

	let snapshot = buildSnapshot();

	function notify(): void {
		snapshot = buildSnapshot();
		for (const listener of listeners) {
			listener();
		}
	}

	function setStatus(key: string, value: MetadataLoadStatus): void {
		if (statusOf(key) === value) {
			return;
		}
		if (value === 'idle') {
			status.delete(key);
		} else {
			status.set(key, value);
		}
		notify();
	}

	function loadKeyed<T>(load: KeyedLoad<T>): Promise<T> {
		if (load.isLoaded()) {
			return Promise.resolve(load.cached());
		}
		const existing = inFlight.get(load.key);
		if (existing) {
			return existing as Promise<T>;
		}
		setStatus(load.key, 'loading');
		const fetchedForGeneration = generation;
		const fresh = () => generation === fetchedForGeneration;
		const promise = load
			.fetch()
			.then((data) => {
				// Discard if the Vault changed while the fetch was in flight (see `reset`).
				if (fresh()) {
					load.store(data);
					setStatus(load.key, 'loaded');
				}
				return data;
			})
			.catch((error) => {
				if (load.soft) {
					// Enrichment-only resources degrade silently to empty and are not cached, so a later
					// demand re-attempts — with no `error` status to surface.
					if (fresh()) {
						setStatus(load.key, 'idle');
					}
					return load.empty;
				}
				if (fresh()) {
					setStatus(load.key, 'error');
				}
				throw error;
			})
			.finally(() => {
				// Only clear our own entry: a reset mid-flight replaces this key with the new Vault's
				// in-flight promise, and this late settle must not evict that fresher request.
				if (inFlight.get(load.key) === promise) {
					inFlight.delete(load.key);
				}
			});
		inFlight.set(load.key, promise);
		return promise;
	}

	function getTargets(): Promise<readonly VaultObjectSummary[]> {
		return loadKeyed({
			key: TARGETS_KEY,
			soft: false,
			isLoaded: () => statusOf(TARGETS_KEY) === 'loaded',
			cached: () => index.objectSummaries(),
			empty: [],
			fetch: () => deps.requestTargets(),
			store: (data) => {
				index = index.withObjects(data);
			},
		});
	}

	function getConfigurableObjects(): Promise<readonly VaultObjectMetadataSummary[]> {
		return loadKeyed({
			key: CONFIGURABLE_OBJECTS_KEY,
			// Soft: a failed load degrades to an empty set → every object relationship classifies dynamic
			// and resolves its real SHOW FIELDS. Correct (never wrong fields), just chattier — so a
			// transient failure must not block the builder with an `error` status.
			soft: true,
			isLoaded: () => index.configurableObjectsLoaded(),
			cached: () => index.configurableObjectNames().map((name) => ({ name })),
			empty: [],
			fetch: () => deps.requestConfigurableObjects(),
			store: (data) => {
				index = index.withConfigurableObjects(data.map((object) => object.name));
			},
		});
	}

	function getFields(target: string): Promise<readonly VaultFieldMeta[]> {
		return loadKeyed({
			key: fieldsKey(target),
			soft: false,
			isLoaded: () => index.fieldsLoaded(target),
			cached: () => index.fieldsFor(target),
			empty: [],
			fetch: () => deps.requestFields(target),
			store: (data) => {
				index = index.withFields(target, data);
			},
		});
	}

	function getRelationships(target: string): Promise<readonly VaultRelationshipMeta[]> {
		return loadKeyed({
			key: relationshipsKey(target),
			soft: true,
			isLoaded: () => index.relationshipsLoaded(target),
			cached: () => index.relationshipsFor(target),
			empty: [],
			fetch: () => deps.requestRelationships(target),
			store: (data) => {
				index = index.withRelationships(target, data);
			},
		});
	}

	function getPicklistFields(target: string): Promise<Record<string, string>> {
		return loadKeyed({
			key: picklistFieldsKey(target),
			soft: true,
			isLoaded: () => statusOf(picklistFieldsKey(target)) === 'loaded',
			cached: () => index.picklistFieldsFor(target),
			empty: {},
			fetch: () => deps.requestPicklistFields(target),
			store: (data) => {
				picklistFieldsByTarget.set(target, new Map(Object.entries(data)));
				index = index.withPicklistFields(new Map(picklistFieldsByTarget));
			},
		});
	}

	function getPicklistValues(picklist: string): Promise<readonly VaultPicklistValue[]> {
		return loadKeyed({
			key: picklistValuesKey(picklist),
			soft: true,
			isLoaded: () => index.picklistValuesLoaded(picklist),
			cached: () => index.picklistValuesFor(picklist),
			empty: [],
			fetch: () => deps.requestPicklistValues(picklist),
			store: (data) => {
				index = index.withPicklistValues(picklist, data);
			},
		});
	}

	// The resolved getters ensure the underlying slices are loaded, then answer from the live index —
	// the join runs once here so neither consumer re-implements it.
	async function getFieldType(target: string, field: string): Promise<string | undefined> {
		await Promise.all([getFields(target), getPicklistFields(target)]);
		return fieldTypeFrom(index, target, field);
	}

	async function getOperatorsFor(
		target: string,
		field: string,
	): Promise<readonly FilterOperator[]> {
		return operatorsForFieldType(await getFieldType(target, field));
	}

	async function isPicklist(target: string, field: string): Promise<boolean> {
		await getPicklistFields(target);
		return Boolean(index.picklistNameFor(target, field));
	}

	function reset(): void {
		generation += 1;
		index = MetadataIndex.EMPTY;
		status.clear();
		inFlight.clear();
		picklistFieldsByTarget.clear();
		notify();
	}

	function onConnection(state: ConnectionSnapshot): void {
		const dns = state.vaultDns;
		if (!dns) {
			// Disconnected (or any other not-yet-connected status, which likewise reports no DNS): clear
			// the cache so nothing from the dropped Vault stays pickable, and forget which Vault was
			// loaded so a *later* reconnect — even back to the same Vault — re-fetches fresh rather than
			// silently reusing what's now stale.
			if (loadedVaultDns !== undefined) {
				loadedVaultDns = undefined;
				reset();
			}
			return;
		}
		if (dns === loadedVaultDns) {
			// Genuinely still the same live connection (e.g. the active-environment pointer moved between
			// two already-connected Vaults that happen to share a DNS) — nothing to reload.
			return;
		}
		loadedVaultDns = dns;
		reset();
		// Eager `SHOW TARGETS` pre-warm so the first `FROM` completion is instant; swallow failure (the
		// `error` status the load records is what the panel surfaces).
		void getTargets().catch(() => undefined);
		// Warm the configurable-object list alongside it (one bulk `/metadata/vobjects` call) so the
		// object-vs-dynamic relationship split is decided from the authoritative set by the time the user
		// expands relationships — a failed warm just leaves everything dynamic (see getConfigurableObjects).
		void getConfigurableObjects().catch(() => undefined);
	}

	const unsubscribeConnection = deps.onConnectionState(onConnection);

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => snapshot,
		getTargets,
		getConfigurableObjects,
		getFields,
		getRelationships,
		getPicklistFields,
		getPicklistValues,
		getFieldType,
		getOperatorsFor,
		isPicklist,
		dispose: unsubscribeConnection,
	};
}
