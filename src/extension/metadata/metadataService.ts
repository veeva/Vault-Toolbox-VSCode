import type {
	ToolboxFeatureArea,
	VaultFieldMeta,
	VaultObjectMetadataSummary,
	VaultObjectSummary,
	VaultPicklistValue,
	VaultRelationshipMeta,
} from '../../core/rest/types';
import type { VaultClient } from '../../core/rest/vaultClient';
import { MetadataIndex } from '../../core/vql/metadataIndex';
import { buildPicklistFieldIndex } from '../../core/vql/picklistIndex';
import type { RunnableConnection } from '../connection/types';

/** Every Vault API call this service makes backs VQL Editor completion (see reference-id-header SPEC). */
const REFERENCE_ID: ToolboxFeatureArea = 'toolbox-vql-editor';

/** One keyed, de-duped, stale-vault-guarded lazy load — the shared shape of `getFields`,
 *  `getRelationships`, and `getPicklistValues` (see {@link MetadataService.loadKeyed}). */
interface KeyedLoad<T> {
	/** The per-resource in-flight map this load de-dupes through. */
	inFlight: Map<string, Promise<T[]>>;
	/** The cache key (a target name or picklist name). */
	key: string;
	/** Whether the slice is already cached, so no fetch is needed. */
	isLoaded: boolean;
	/** The cached slice, read only when `isLoaded`. */
	cached: () => readonly T[];
	/** The Vault call that fetches the slice. */
	fetch: (client: VaultClient) => Promise<T[]>;
	/** Record the fetched slice into the index (only reached when the vault hasn't changed). */
	store: (values: T[]) => void;
}

/**
 * Host-side metadata cache backing VQL completion, sourced from Vault's `SHOW` queries: query
 * targets (`SHOW TARGETS`) load eagerly on first request, a target's fields (`SHOW FIELDS`) load
 * lazily. Fetches run through `connection.run` (session recovery included). In-flight requests are
 * de-duped, and the cache is cleared whenever the connected vault changes (stale-vault guard).
 * Failed `SHOW` calls are not cached, so a later demand simply re-attempts. vscode-free.
 */
export class MetadataService {
	private index = MetadataIndex.EMPTY;
	private vaultId?: number;
	private targetsLoaded = false;
	private targetsInFlight?: Promise<VaultObjectSummary[]>;
	private configurableObjectsLoaded = false;
	private configurableObjectsInFlight?: Promise<VaultObjectMetadataSummary[]>;
	private readonly fieldsInFlight = new Map<string, Promise<VaultFieldMeta[]>>();
	private readonly relationshipsInFlight = new Map<string, Promise<VaultRelationshipMeta[]>>();
	private picklistIndexInFlight?: Promise<void>;
	private readonly picklistValuesInFlight = new Map<string, Promise<VaultPicklistValue[]>>();

	constructor(private readonly connection: RunnableConnection) {}

	/** List all query targets from `SHOW TARGETS` (cached after the first load). The vault-wide picklist
	 *  index is pre-warmed alongside it (fire-and-forget) so a field's picklist-ness is known by the
	 *  time the WHERE builder needs it, without a connect-time N+1 burst of value fetches. */
	async getTargets(): Promise<VaultObjectSummary[]> {
		this.syncVault();
		void this.ensurePicklistIndex().catch(() => undefined);
		if (this.targetsLoaded) {
			return [...this.index.objectSummaries()];
		}
		if (!this.targetsInFlight) {
			const fetchedForVaultId = this.vaultId;
			this.targetsInFlight = this.connection
				.run((client) => client.vql.showTargets(REFERENCE_ID))
				.then((targets) => {
					// Discard if the vault changed while the fetch was in flight — otherwise a stale
					// callback would write the old vault's targets into the freshly-reset index.
					if (this.vaultId === fetchedForVaultId) {
						this.index = this.index.withObjects(targets);
						this.targetsLoaded = true;
					}
					return targets;
				})
				.finally(() => {
					this.targetsInFlight = undefined;
				});
		}
		return this.targetsInFlight;
	}

	/**
	 * List the configurable objects from `GET /metadata/vobjects` (cached after the first load; de-duped,
	 * stale-vault-guarded — same model as {@link getTargets}). The VQL Builder's object-vs-dynamic
	 * relationship split keys off membership in this set: an object present here carries the standard
	 * field set (so a relationship to it keeps the hardcoded table), one absent does not (so its real
	 * `SHOW FIELDS` is resolved).
	 */
	async getConfigurableObjects(): Promise<VaultObjectMetadataSummary[]> {
		this.syncVault();
		if (this.configurableObjectsLoaded) {
			return this.index.configurableObjectNames().map((name) => ({ name }));
		}
		if (!this.configurableObjectsInFlight) {
			const fetchedForVaultId = this.vaultId;
			this.configurableObjectsInFlight = this.connection
				.run((client) => client.metadata.listConfigurableObjects(REFERENCE_ID))
				.then((objects) => {
					// Discard if the vault changed mid-fetch (see getTargets).
					if (this.vaultId === fetchedForVaultId) {
						this.index = this.index.withConfigurableObjects(objects.map((object) => object.name));
						this.configurableObjectsLoaded = true;
					}
					return objects;
				})
				.finally(() => {
					this.configurableObjectsInFlight = undefined;
				});
		}
		return this.configurableObjectsInFlight;
	}

	/** Retrieve one target's fields from `SHOW FIELDS` (cached after the first load; de-duped). */
	getFields(target: string): Promise<VaultFieldMeta[]> {
		this.syncVault();
		return this.loadKeyed({
			inFlight: this.fieldsInFlight,
			key: target,
			isLoaded: this.index.fieldsLoaded(target),
			cached: () => this.index.fieldsFor(target),
			fetch: (client) => client.vql.showFields(target, REFERENCE_ID),
			store: (fields) => {
				this.index = this.index.withFields(target, fields);
			},
		});
	}

	/** Retrieve one target's relationships from `SHOW RELATIONSHIPS` (cached after the first load;
	 *  de-duped, lazy per target — same model as {@link getFields}). */
	getRelationships(target: string): Promise<VaultRelationshipMeta[]> {
		this.syncVault();
		return this.loadKeyed({
			inFlight: this.relationshipsInFlight,
			key: target,
			isLoaded: this.index.relationshipsLoaded(target),
			cached: () => this.index.relationshipsFor(target),
			fetch: (client) => client.vql.showRelationships(target, REFERENCE_ID),
			store: (relationships) => {
				this.index = this.index.withRelationships(target, relationships);
			},
		});
	}

	/**
	 * The `field → picklistName` slice for one query target, from the vault-wide picklist index
	 * (Retrieve All Picklists). The index loads eagerly (see {@link getTargets}) but this ensures it
	 * regardless, so a slice request never races ahead of the warm. A field's presence here is the
	 * authoritative picklist signal for the WHERE builder.
	 */
	async getPicklistFields(target: string): Promise<Record<string, string>> {
		this.syncVault();
		await this.ensurePicklistIndex();
		return this.index.picklistFieldsFor(target);
	}

	/** Retrieve one picklist's values (Retrieve Picklist Values), lazy per picklist name and cached
	 *  after the first load — same de-duped, stale-vault-guarded model as {@link getFields}. */
	getPicklistValues(picklist: string): Promise<VaultPicklistValue[]> {
		this.syncVault();
		return this.loadKeyed({
			inFlight: this.picklistValuesInFlight,
			key: picklist,
			isLoaded: this.index.picklistValuesLoaded(picklist),
			cached: () => this.index.picklistValuesFor(picklist),
			fetch: (client) => client.metadata.retrievePicklistValues(picklist, REFERENCE_ID),
			store: (values) => {
				this.index = this.index.withPicklistValues(picklist, values);
			},
		});
	}

	/**
	 * The shared keyed-lazy-load path behind {@link getFields}, {@link getRelationships}, and
	 * {@link getPicklistValues}: return the cached slice if present, else fetch once (de-duped via the
	 * per-resource in-flight map) and write the result into the index — but only if the connected vault
	 * hasn't changed since the fetch began, so a stale callback never poisons a freshly-reset index.
	 */
	private loadKeyed<T>(load: KeyedLoad<T>): Promise<T[]> {
		if (load.isLoaded) {
			return Promise.resolve([...load.cached()]);
		}
		let inFlight = load.inFlight.get(load.key);
		if (!inFlight) {
			const fetchedForVaultId = this.vaultId;
			inFlight = this.connection
				.run(load.fetch)
				.then((values) => {
					if (this.vaultId === fetchedForVaultId) {
						load.store(values);
					}
					return values;
				})
				.finally(() => {
					load.inFlight.delete(load.key);
				});
			load.inFlight.set(load.key, inFlight);
		}
		return inFlight;
	}

	/** Load the vault-wide field→picklistName index once (de-duped, stale-vault-guarded). Resolves as
	 *  soon as the index is present; a failure leaves it unloaded so a later demand re-attempts. */
	private ensurePicklistIndex(): Promise<void> {
		if (this.index.picklistFieldsLoaded()) {
			return Promise.resolve();
		}
		if (!this.picklistIndexInFlight) {
			const fetchedForVaultId = this.vaultId;
			// `Promise.resolve().then` so a synchronous throw from `connection.run` becomes a rejection the
			// fire-and-forget warm in getTargets can swallow, rather than escaping into that caller.
			this.picklistIndexInFlight = Promise.resolve()
				.then(() => this.connection.run((client) => client.metadata.retrieveAllPicklists(REFERENCE_ID)))
				.then((picklists) => {
					// Discard if the vault changed mid-fetch (see getTargets).
					if (this.vaultId === fetchedForVaultId) {
						this.index = this.index.withPicklistFields(buildPicklistFieldIndex(picklists));
					}
				})
				.finally(() => {
					this.picklistIndexInFlight = undefined;
				});
		}
		return this.picklistIndexInFlight;
	}

	/** Drop the cache when the connected vault changes or disconnects. */
	private syncVault(): void {
		const id = this.connection.getState().info?.vaultId;
		if (id !== this.vaultId) {
			this.vaultId = id;
			this.index = MetadataIndex.EMPTY;
			this.targetsLoaded = false;
			this.targetsInFlight = undefined;
			this.configurableObjectsLoaded = false;
			this.configurableObjectsInFlight = undefined;
			this.fieldsInFlight.clear();
			this.relationshipsInFlight.clear();
			this.picklistIndexInFlight = undefined;
			this.picklistValuesInFlight.clear();
		}
	}
}
