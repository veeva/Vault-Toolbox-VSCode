import type {
	VaultFieldMeta,
	VaultObjectSummary,
	VaultPicklistValue,
	VaultRelationshipMeta,
} from '../rest/types';
import {
	type PicklistFieldIndex,
	picklistFieldsForContainer,
	picklistNameForField,
} from './picklistIndex';

/**
 * Immutable read view of Vault metadata for VQL completion.
 * Two-tier: object names load eagerly, an object's fields lazily. Kept
 * vscode-free and pure — the host `MetadataService` owns fetching and swaps in new snapshots.
 *
 * `fieldsLoaded(object)` distinguishes "no fields" from "not yet fetched" so callers know when to
 * trigger a lazy load.
 */
/** The immutable backing state of a {@link MetadataIndex} — one field per loaded metadata slice. */
interface MetadataIndexState {
	objects: readonly VaultObjectSummary[];
	fieldsByObject: ReadonlyMap<string, readonly VaultFieldMeta[]>;
	relationshipsByObject: ReadonlyMap<string, readonly VaultRelationshipMeta[]>;
	/** The vault-wide field→picklistName reverse-map; `undefined` until it's been loaded. */
	picklistFields: PicklistFieldIndex | undefined;
	/** Per-picklist values, lazily loaded per picklist name (`has` distinguishes loaded-empty). */
	picklistValuesByName: ReadonlyMap<string, readonly VaultPicklistValue[]>;
	/** The names of every configurable object (`GET /metadata/vobjects`); `undefined` until loaded, so
	 *  "not yet loaded" is distinguishable from "loaded, empty". */
	configurableObjectNames: ReadonlySet<string> | undefined;
}

export class MetadataIndex {
	static readonly EMPTY = new MetadataIndex({
		objects: [],
		fieldsByObject: new Map(),
		relationshipsByObject: new Map(),
		picklistFields: undefined,
		picklistValuesByName: new Map(),
		configurableObjectNames: undefined,
	});

	private readonly objects: readonly VaultObjectSummary[];
	private readonly fieldsByObject: ReadonlyMap<string, readonly VaultFieldMeta[]>;
	private readonly relationshipsByObject: ReadonlyMap<string, readonly VaultRelationshipMeta[]>;
	private readonly picklistFields: PicklistFieldIndex | undefined;
	private readonly picklistValuesByName: ReadonlyMap<string, readonly VaultPicklistValue[]>;
	private readonly configurableObjects: ReadonlySet<string> | undefined;

	private constructor(state: MetadataIndexState) {
		this.objects = state.objects;
		this.fieldsByObject = state.fieldsByObject;
		this.relationshipsByObject = state.relationshipsByObject;
		this.picklistFields = state.picklistFields;
		this.picklistValuesByName = state.picklistValuesByName;
		this.configurableObjects = state.configurableObjectNames;
	}

	/** Snapshot the current slices as a fresh state object, so a `with*` copy can override just one. */
	private currentState(): MetadataIndexState {
		return {
			objects: this.objects,
			fieldsByObject: this.fieldsByObject,
			relationshipsByObject: this.relationshipsByObject,
			picklistFields: this.picklistFields,
			picklistValuesByName: this.picklistValuesByName,
			configurableObjectNames: this.configurableObjects,
		};
	}

	/** All object summaries (name + label), in Vault's order. */
	objectSummaries(): readonly VaultObjectSummary[] {
		return this.objects;
	}

	/** All object names, in Vault's order. */
	objectNames(): readonly string[] {
		return this.objects.map((summary) => summary.name);
	}

	/** Fields of `object`; empty until they've been loaded (check `fieldsLoaded`). */
	fieldsFor(object: string): readonly VaultFieldMeta[] {
		return this.fieldsByObject.get(object) ?? [];
	}

	fieldsLoaded(object: string): boolean {
		return this.fieldsByObject.has(object);
	}

	/** Relationships of `object`; empty until they've been loaded (check `relationshipsLoaded`). */
	relationshipsFor(object: string): readonly VaultRelationshipMeta[] {
		return this.relationshipsByObject.get(object) ?? [];
	}

	relationshipsLoaded(object: string): boolean {
		return this.relationshipsByObject.has(object);
	}

	/** The picklist name `object`'s `field` uses, or `undefined` when the field is not a picklist (or
	 *  the index hasn't loaded). Presence is the authoritative picklist signal (not a SHOW type). */
	picklistNameFor(object: string, field: string): string | undefined {
		return this.picklistFields && picklistNameForField(this.picklistFields, object, field);
	}

	picklistFieldsLoaded(): boolean {
		return this.picklistFields !== undefined;
	}

	/** The `field → picklistName` slice for one query target — the WHERE builder's per-`FROM` view.
	 *  Empty when the index hasn't loaded or the target has no picklist fields. */
	picklistFieldsFor(object: string): Record<string, string> {
		return this.picklistFields ? picklistFieldsForContainer(this.picklistFields, object) : {};
	}

	/** Values of the picklist named `name`; empty until loaded (check `picklistValuesLoaded`). */
	picklistValuesFor(name: string): readonly VaultPicklistValue[] {
		return this.picklistValuesByName.get(name) ?? [];
	}

	picklistValuesLoaded(name: string): boolean {
		return this.picklistValuesByName.has(name);
	}

	/** Whether `name` is a real configurable object (present in `GET /metadata/vobjects`). `false` until
	 *  the list has loaded — the safe default, so a not-yet-known target never wrongly reads as a real
	 *  object (check {@link configurableObjectsLoaded} to tell "not configurable" from "not yet loaded"). */
	isConfigurableObject(name: string): boolean {
		return this.configurableObjects?.has(name) ?? false;
	}

	configurableObjectsLoaded(): boolean {
		return this.configurableObjects !== undefined;
	}

	/** The configurable-object names, in no particular order; empty until loaded. */
	configurableObjectNames(): readonly string[] {
		return this.configurableObjects ? [...this.configurableObjects] : [];
	}

	/** Return a new index with the object list replaced (field/relationship slices preserved). */
	withObjects(objects: readonly VaultObjectSummary[]): MetadataIndex {
		return new MetadataIndex({ ...this.currentState(), objects: [...objects] });
	}

	/** Return a new index with the configurable-object name set recorded. */
	withConfigurableObjects(names: readonly string[]): MetadataIndex {
		return new MetadataIndex({
			...this.currentState(),
			configurableObjectNames: new Set(names),
		});
	}

	/** Return a new index with `object`'s fields recorded. */
	withFields(object: string, fields: readonly VaultFieldMeta[]): MetadataIndex {
		const next = new Map(this.fieldsByObject);
		next.set(object, [...fields]);
		return new MetadataIndex({ ...this.currentState(), fieldsByObject: next });
	}

	/** Return a new index with `object`'s relationships recorded. */
	withRelationships(object: string, relationships: readonly VaultRelationshipMeta[]): MetadataIndex {
		const next = new Map(this.relationshipsByObject);
		next.set(object, [...relationships]);
		return new MetadataIndex({ ...this.currentState(), relationshipsByObject: next });
	}

	/** Return a new index with the vault-wide field→picklistName reverse-map recorded. */
	withPicklistFields(index: PicklistFieldIndex): MetadataIndex {
		return new MetadataIndex({ ...this.currentState(), picklistFields: index });
	}

	/** Return a new index with one picklist's values recorded. */
	withPicklistValues(name: string, values: readonly VaultPicklistValue[]): MetadataIndex {
		const next = new Map(this.picklistValuesByName);
		next.set(name, [...values]);
		return new MetadataIndex({ ...this.currentState(), picklistValuesByName: next });
	}
}
