import type { VaultFieldMeta, VaultObjectSummary, VaultRelationshipMeta } from '../rest/types';
import {
	type FilterOperator,
	type QueryFilterFieldType,
	resolveFilterFieldType,
} from './queryFilterOperators';
import { formatVql } from './vqlFormat';

/**
 * Pure state + selection logic for the VQL Builder panel, kept DOM-free so it is shared by the
 * webview component and unit-tested in isolation (the repo has no webview component-test harness).
 * The React shell in `webview/editor/builder/` owns rendering and copy; this owns the decisions.
 */

/** Connection lifecycle as reported by the host — mirrors `ConnectionSnapshot.status`. */
export type BuilderConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Load lifecycle of an async metadata resource fetched over the bus (e.g. `SHOW TARGETS`). */
export type MetadataLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** A metadata resource paired with its load lifecycle — the raw input to body derivation. */
export interface MetadataResource<T> {
	status: MetadataLoadStatus;
	data?: T;
}

/**
 * What the expanded builder body should render. The `EditorHeader` remains the authoritative
 * connection-status surface, so these tags never re-report connection status — they only decide the
 * builder's own body:
 * - `gated` — not connected (regardless of any previously-loaded targets).
 * - `loading` — `SHOW TARGETS` in flight (or about to start).
 * - `error` — `SHOW TARGETS` failed; the body offers a scoped Retry.
 * - `empty` — `SHOW TARGETS` succeeded with zero rows; the body shows a permissions hint, no Retry.
 * - `ready` — targets are available; the body shows the `FROM` combobox.
 */
export type BuilderBodyKind = 'gated' | 'loading' | 'error' | 'empty' | 'ready';

/**
 * Decide the builder body from the connection status and the `SHOW TARGETS` load.
 *
 * Connection status is checked first and gates uniformly across disconnected/connecting/error (the
 * header differentiates them; the builder body does not) — even when a target list is still sitting in
 * the store from a now-dropped connection. A disconnected Vault must never leave a stale target list
 * pickable (see `docs/defects/query-builder-target-selectable-after-disconnect.md`); the store clears
 * that cache on disconnect too (see `metadataStore.onConnection`), so `targets` is expected to already be
 * back to `idle`/`loading` by the time this runs — this check is the belt to that store's suspenders.
 */
export function deriveBuilderBody(
	connection: BuilderConnectionStatus,
	targets: MetadataResource<VaultObjectSummary[]>,
): BuilderBodyKind {
	if (connection !== 'connected') {
		return 'gated';
	}
	if (targets.status === 'loaded') {
		return (targets.data?.length ?? 0) > 0 ? 'ready' : 'empty';
	}
	if (targets.status === 'error') {
		return 'error';
	}
	// `idle` (pre-warm about to fire) and `loading` both present the in-flight placeholder.
	return 'loading';
}

/** The raw Vault `type` token of the loaded field named `name` (`undefined` if unnamed or not found).
 *  The WHERE builder resolves each row's operators and value widget from this. */
export function fieldTypeByName(
	fields: readonly VaultFieldMeta[],
	name: string | undefined,
): string | undefined {
	return name ? fields.find((field) => field.name === name)?.type : undefined;
}

/**
 * A field's effective type for operator/value/quoting decisions. A field present in the picklist index
 * is authoritatively `Picklist` — its values quote as string literals — regardless of the raw type
 * token `SHOW FIELDS` reported; otherwise the raw token from {@link fieldTypeByName} is used. This is
 * the single source of the "picklist index outranks the SHOW type" rule shared by the WHERE builder,
 * the assembled query, and VQL completion.
 */
export function resolveFieldType(
	fields: readonly VaultFieldMeta[],
	picklistFields: Readonly<Record<string, string>>,
	name: string | undefined,
): string | undefined {
	return name && picklistFields[name] ? 'Picklist' : fieldTypeByName(fields, name);
}

/**
 * Raw Vault `type` tokens that VQL rejects in a WHERE clause **regardless of operator**, so the WHERE
 * builder must not offer a field of this type even though SELECT queries it fine. Verified live: Vault
 * answers `WHERE longtext_field = 'x'` (and `LIKE`) with `[LongText] field [...] is not supported with
 * operator [...] in [this context]`, and the same for `RichText`. Matched case-insensitively against
 * the token.
 *
 * These are the two the builder can detect from `SHOW FIELDS` alone (which reports only name/label/type).
 * **Formula** and **non-searchable Lookup** fields are also unfilterable, but `SHOW FIELDS` reports them
 * under their base type (a formula is `String`, a lookup takes its source field's type), so they can't be
 * excluded here — that needs the per-object `/metadata/vobjects` `formula`/`searchable`/`lookup_source_field`
 * signals the store doesn't fetch (see
 * `docs/defects/vql-builder-nonfilterable-fields-selectable-in-where.md`).
 */
const NON_FILTERABLE_FIELD_TYPES: ReadonlySet<string> = new Set(['longtext', 'richtext']);

/** Whether a field of this raw Vault `type` token may appear in a WHERE filter at all (see
 *  {@link NON_FILTERABLE_FIELD_TYPES}). A missing token is treated as filterable — the WHERE builder
 *  degrades permissively rather than hiding a field of unknown type. */
export function isWhereFilterableType(fieldType: string | undefined): boolean {
	return !fieldType || !NON_FILTERABLE_FIELD_TYPES.has(fieldType.trim().toLowerCase());
}

/** The subset of `fields` the WHERE builder may offer: every SELECTable field minus the types VQL
 *  rejects in a WHERE clause (see {@link isWhereFilterableType}). The SELECT picker keeps the full list;
 *  only the filter-field picker is narrowed, so a LongText/RichText field can still be selected for
 *  output but never filtered on. */
export function whereFilterableFields(
	fields: readonly VaultFieldMeta[],
): readonly VaultFieldMeta[] {
	return fields.filter((field) => isWhereFilterableType(field.type));
}

/** A hardcoded standard field a relationship is expanded with, plus its SPEC-level `fieldType` (the
 *  `queryFilterOperators` row name) so the field is WHERE-ready. */
export interface RelationshipStandardField {
	name: string;
	label: string;
	fieldType: string;
}

/**
 * The hardcoded standard field set an **object** relationship is expanded with in the Fields dropdown.
 * v1 does not lazy-load the related target's own `SHOW FIELDS`; every object relationship — outbound or
 * inbound — offers exactly these fields, in this order. Document relationships use
 * {@link RELATIONSHIP_DOCUMENT_FIELDS} instead.
 */
export const RELATIONSHIP_STANDARD_FIELDS: ReadonlyArray<RelationshipStandardField> = [
	{ name: 'id', label: 'ID', fieldType: 'Object' },
	{ name: 'name__v', label: 'Name', fieldType: 'String' },
	{ name: 'created_by__v', label: 'Created By', fieldType: 'Object' },
	{ name: 'created_date__v', label: 'Created Date', fieldType: 'DateTime' },
	{ name: 'status__v', label: 'Status', fieldType: 'Picklist' },
	{ name: 'modified_by__v', label: 'Modified By', fieldType: 'Object' },
	{ name: 'modified_date__v', label: 'Modified Date', fieldType: 'DateTime' },
];

/**
 * The hardcoded standard field set a **document** relationship is expanded with. Document joins expose a
 * different field vocabulary than objects (see the Vault join docs), so a relationship whose target is
 * the `documents` object offers these instead of {@link RELATIONSHIP_STANDARD_FIELDS} (see
 * {@link relationshipFieldSource}).
 */
export const RELATIONSHIP_DOCUMENT_FIELDS: ReadonlyArray<RelationshipStandardField> = [
	{ name: 'id', label: 'ID', fieldType: 'Object' },
	{ name: 'name__v', label: 'Name', fieldType: 'String' },
	{ name: 'created_by__v', label: 'Created By', fieldType: 'Object' },
	{ name: 'title__v', label: 'Title', fieldType: 'String' },
	{ name: 'type__v', label: 'Type', fieldType: 'String' },
	{ name: 'subtype__v', label: 'Subtype', fieldType: 'String' },
	{ name: 'classification__v', label: 'Classification', fieldType: 'String' },
	{ name: 'document_number__v', label: 'Document Number', fieldType: 'String' },
	{ name: 'lifecycle__v', label: 'Lifecycle', fieldType: 'String' },
	{ name: 'document_creation_date__v', label: 'Created Date', fieldType: 'DateTime' },
	{ name: 'status__v', label: 'Status', fieldType: 'String' },
	{ name: 'last_modified_by__v', label: 'Last Modified By', fieldType: 'Object' },
	{ name: 'version_modified_date__v', label: 'Last Modified Date', fieldType: 'DateTime' },
];

/**
 * Whether a relationship is a child (`inbound` → subquery) rather than a parent lookup (`outbound` →
 * dotted traversal). Case-insensitive; anything that isn't `inbound` is treated as outbound, so an
 * unexpected type token degrades to the traversal construction rather than being dropped.
 */
export function isInboundRelationship(relationship: { type: string }): boolean {
	return relationship.type.trim().toLowerCase() === 'inbound';
}

/** The VQL parent-traversal expression for an outbound relationship field: `relationship.field`. */
export function outboundFieldExpression(relationship: string, fieldName: string): string {
	return `${relationship}.${fieldName}`;
}

/**
 * One selectable row in the relationship-expanded Fields dropdown: a single field of one relationship,
 * carrying everything the panel needs to render it and construct its VQL. `inbound` selects the
 * construction — an inbound pick accumulates into a subquery block, an outbound pick adds a dotted
 * chip. `label` is the full dropdown row text.
 */
export interface RelationshipFieldOption {
	/** The relationship name referenced in VQL (e.g. `manufacturer__cr`). */
	relationship: string;
	/** The related query target's API name. */
	target: string;
	/** The related target's human label, falling back to its API name. */
	targetLabel: string;
	/** True for an inbound (child → subquery) relationship; false for outbound (parent → traversal). */
	inbound: boolean;
	/** The related field's API name (from the related target's real `SHOW FIELDS`). */
	fieldName: string;
	/** The related field's label, falling back to its API name. */
	fieldLabel: string;
	/** The related field's raw Vault `type` token, for WHERE operator/value/quoting resolution
	 *  (resolved case-insensitively by {@link resolveFilterFieldType}). */
	fieldType: string;
	/** Full dropdown row label: `<Target Label> (<relationship>): <Field Label> (<field>)`. */
	label: string;
}

/**
 * Expand one relationship into a dropdown option per field of its related target's **real**
 * `SHOW FIELDS` — the shared seam both the Builder panel and editor completion resolve a relationship's
 * fields through (see `webview/editor/vqlCompletion.ts`), so the two agree exactly. This is
 * the pure, DOM-free, fetch-free core: the caller has already
 * loaded the target's fields (mirroring how the panel already receives a `targetLabelOf` resolver
 * rather than reaching for a table) and passes them in, so the object-vs-document attachment split
 * falls out automatically from the reported target with no name guessing. An empty field list yields
 * no options, matching how the Builder degrades a target whose fields fail to load or resolve to zero.
 *
 * Each option carries the field's raw Vault `type` token so the WHERE builder resolves its
 * operators/quoting case-insensitively (see {@link resolveFilterFieldType}); the row label is
 * `<Target Label> (<relationship>): <Field Label> (<field>)`, with the field label falling back to its
 * API name and `targetLabel` falling back to the target's API name.
 */
export function relationshipFieldOptions(
	relationship: VaultRelationshipMeta,
	fields: readonly VaultFieldMeta[],
	targetLabel: string = relationship.target,
): RelationshipFieldOption[] {
	const inbound = isInboundRelationship(relationship);
	return fields.map((field) => {
		const fieldLabel = field.label ?? field.name;
		return {
			relationship: relationship.name,
			target: relationship.target,
			targetLabel,
			inbound,
			fieldName: field.name,
			fieldLabel,
			fieldType: field.type ?? '',
			label: `${targetLabel} (${relationship.name}): ${fieldLabel} (${field.name})`,
		};
	});
}

/** Where a relationship's Fields-dropdown vocabulary comes from:
 *  - `document` — a join to the `documents` object; the stable {@link RELATIONSHIP_DOCUMENT_FIELDS} table
 *    (no fetch).
 *  - `object` — the target is a real **configurable object** (present in `GET /metadata/vobjects`),
 *    which carries the standard field set regardless of its `source` (standard/custom/system); the
 *    {@link RELATIONSHIP_STANDARD_FIELDS} table (no fetch).
 *  - `dynamic` — any other target **absent** from `/metadata/vobjects`: a special subquery-only
 *    target (attachment, signature, workflow, job, …) or the binder model, whose real vocabulary the
 *    standard set gets wrong (the attachments bug); its fields must be resolved from the target's real
 *    `SHOW FIELDS`. */
export type RelationshipFieldSource = 'document' | 'object' | 'dynamic';

/**
 * Decide where a relationship's field vocabulary comes from, keyed on the **resolved target's identity**,
 * never the relationship name. A join to the `documents` object uses the document table; a target that is
 * a real configurable object uses the standard table (so a normal object with many relationships costs no
 * per-target fetches); every other target resolves dynamically from its own `SHOW FIELDS`.
 *
 * Classifying on the target — not a `document_` name prefix — is what lets a special subquery-only target
 * like `document_signature__sysr → document_signature__sys` resolve its real fields instead of being
 * misrouted to the document table (see
 * `docs/defects/vql-builder-document-prefix-misroutes-special-targets.md`).
 *
 * One case does need the name back: a document field of type *Object* creates a bidirectional
 * `document_{object}__vr`/`__cr` relationship (see
 * https://general.veevavault.dev/vql/joins/about-join-queries#Object_Reference_Field_on_Document). Queried
 * **inbound** from the object's own side, `SHOW RELATIONSHIPS` mis-reports `target` as that object itself
 * rather than `documents` — a metadata quirk, confirmed live: `test__c`'s inbound `document_test_object__cr`
 * reports `target: "test__c"`, yet its subquery's real `queryDescribe.subqueries[0].object.name` is
 * `"documents"`, and selecting `test__c`'s own standard fields fails with `Unknown field 'created_date__v'`
 * while {@link RELATIONSHIP_DOCUMENT_FIELDS} succeeds (see
 * `docs/defects/vql-builder-inbound-document-relationship-misroutes-object-fields.md`). Requiring all three
 * of inbound + a `document_` name prefix + a real configurable target is what makes this reliable: dropping
 * any one reintroduces a false positive — `document_signature__sysr`'s target isn't configurable (stays
 * `dynamic`), and a genuine self-reference like `users__sysr → user__sys` doesn't have the `document_`
 * prefix (stays `object`). The **outbound** direction of this same relationship name is unaffected — from
 * `documents`' own `SHOW RELATIONSHIPS`, its reported target is correct, and a dot-lookup against the
 * standard table already succeeds there.
 *
 * `isConfigurableObject` reports membership in the loaded `/metadata/vobjects` list — the signal that
 * reliably separates a real object from a query-only target. `SHOW TARGETS` membership is deliberately
 * *not* used: targets like `job_instance__sys` / `active_workflow_job__sys` are queryable (listed by
 * `SHOW TARGETS`) yet are not real objects and lack the standard field set. The predicate is `false`
 * until the list has loaded, so an as-yet-unknown target classifies `dynamic` (fetch) rather than
 * wrongly using the table — the safe direction. `binders` (absent from `/metadata/vobjects`) correctly
 * resolves `dynamic` too.
 */
export function relationshipFieldSource(
	relationship: Pick<VaultRelationshipMeta, 'name' | 'target' | 'type'>,
	isConfigurableObject: (target: string) => boolean,
): RelationshipFieldSource {
	const target = relationship.target.trim().toLowerCase();
	if (target === 'documents') {
		return 'document';
	}
	if (
		isInboundRelationship(relationship) &&
		relationship.name.trim().toLowerCase().startsWith('document_') &&
		isConfigurableObject(target)
	) {
		return 'document';
	}
	return isConfigurableObject(target) ? 'object' : 'dynamic';
}

/** Adapt a hardcoded {@link RelationshipStandardField} row to the {@link VaultFieldMeta} shape
 *  {@link relationshipFieldOptions} consumes, so both the table-backed and the dynamic path build
 *  options through the one function. `fieldType` (a SPEC row name) rides in `type`, which
 *  {@link resolveFilterFieldType} folds the same as a raw Vault token. */
function standardFieldsAsMeta(
	fields: readonly RelationshipStandardField[],
): readonly VaultFieldMeta[] {
	return fields.map((field) => ({ name: field.name, type: field.fieldType, label: field.label }));
}

/**
 * How to resolve metadata about a relationship's related target — the three resolvers the option
 * builder needs, bundled because they always travel together (and share a `(target) => …` shape that
 * makes positional passing error-prone). The webview backs them with the metadata store: `fieldsOf`
 * reads already-loaded `SHOW FIELDS`, `labelOf` the `SHOW TARGETS` human label, `isConfigurableObject`
 * membership in `/metadata/vobjects`.
 */
export interface RelationshipTargetResolvers {
	/** The related target's already-loaded real fields — empty until they land, or on failure. */
	fieldsOf(target: string): readonly VaultFieldMeta[];
	/** The related target's human label, or `undefined` to fall back to its API name. */
	labelOf(target: string): string | undefined;
	/** Whether the target is a real configurable object (present in `GET /metadata/vobjects`). */
	isConfigurableObject(target: string): boolean;
}

/** The inert resolvers used when a caller supplies none: no fields, no labels, nothing configurable — so
 *  every relationship classifies `dynamic` and yields no options until real resolvers are passed. */
const NO_TARGET_METADATA: RelationshipTargetResolvers = {
	fieldsOf: () => [],
	labelOf: () => undefined,
	isConfigurableObject: () => false,
};

/**
 * Expand every relationship into its Fields-dropdown options. Each relationship's field vocabulary is
 * sourced per {@link relationshipFieldSource}: document/object relationships from the stable hardcoded
 * tables, special subquery-only targets dynamically from `resolvers.fieldsOf` (the target's real
 * `SHOW FIELDS` the caller pre-loaded). A dynamic target whose fields haven't landed yet (or failed /
 * resolved to zero) yields `[]` and so contributes no options without breaking the rest.
 * `resolvers.labelOf` resolves a related target's human label; when it returns nothing the target's API
 * name is used instead.
 */
export function buildRelationshipOptions(
	relationships: readonly VaultRelationshipMeta[],
	resolvers: RelationshipTargetResolvers = NO_TARGET_METADATA,
): RelationshipFieldOption[] {
	const options: RelationshipFieldOption[] = [];
	for (const relationship of relationships) {
		const targetLabel = resolvers.labelOf(relationship.target) ?? relationship.target;
		const fields = relationshipSourceFields(relationship, resolvers);
		options.push(...relationshipFieldOptions(relationship, fields, targetLabel));
	}
	return options;
}

/** The field rows to expand `relationship` with, per its {@link relationshipFieldSource}. */
function relationshipSourceFields(
	relationship: VaultRelationshipMeta,
	resolvers: RelationshipTargetResolvers,
): readonly VaultFieldMeta[] {
	switch (relationshipFieldSource(relationship, resolvers.isConfigurableObject)) {
		case 'document':
			return standardFieldsAsMeta(RELATIONSHIP_DOCUMENT_FIELDS);
		case 'object':
			return standardFieldsAsMeta(RELATIONSHIP_STANDARD_FIELDS);
		case 'dynamic':
			return resolvers.fieldsOf(relationship.target);
	}
}

/**
 * A snapshot of the previous query's results, used to offer the "filter by previous results" shortcut:
 * the previous statement's root `FROM` object and the `id` values it returned.
 */
export interface PreviousResults {
	/** The previous query's root `FROM` object API name. */
	target: string;
	/** The `id` values from the previous result rows (non-empty when a shortcut is worth offering). */
	ids: readonly string[];
}

/** A ready-to-apply `CONTAINS` filter derived from {@link planPreviousResultsFilter}: the reference
 *  field on the current object and the previous result ids to match against it. */
export interface PreviousResultsFilterPlan {
	/** The reference field on the current object that points at the previous target. */
	field: string;
	/** The previous result ids, emitted as `field CONTAINS (id1, id2, …)`. */
	values: string[];
}

/**
 * Guess the root `FROM` object of a VQL statement by parsing its text.
 *
 * This strips balanced parenthesized groups (relationship subqueries carry their own `FROM`) before
 * matching, so a `SELECT … (SELECT … FROM child) FROM parent` resolves to `parent`, not `child`. It is
 * deliberately **not** a VQL parser and never feeds panel state.
 *
 * **Only use this before a query has run** — e.g. resolving completion context against text the user
 * is still typing, where no API response exists yet. Once a query *has* executed, the authoritative
 * target is `QueryResult.queryDescribe?.object?.name`; never re-derive it by re-parsing the query text.
 */
export function getQueryTargetFromQueryString(vql: string): string | undefined {
	let stripped = vql;
	let previous: string;
	do {
		previous = stripped;
		stripped = stripped.replace(/\([^()]*\)/g, ' ');
	} while (stripped !== previous);
	const match = /\bfrom\s+([a-z0-9_]+)/i.exec(stripped);
	return match ? match[1] : undefined;
}

/**
 * Plan a "filter by previous results" row, or `undefined` when the shortcut doesn't apply. It applies
 * when the current object has an **outbound** relationship whose target is the previous query's object
 * *and* a reference field cross-references that relationship (via `SHOW FIELDS`'s `relationship_name`).
 * The resulting plan filters that reference field against the previous result ids with `CONTAINS`.
 */
export function planPreviousResultsFilter(
	relationships: readonly VaultRelationshipMeta[],
	fields: readonly VaultFieldMeta[],
	previous: PreviousResults | undefined,
): PreviousResultsFilterPlan | undefined {
	if (!previous || previous.ids.length === 0) {
		return undefined;
	}
	for (const relationship of relationships) {
		if (isInboundRelationship(relationship) || relationship.target !== previous.target) {
			continue;
		}
		const field = fields.find((candidate) => candidate.relationship_name === relationship.name);
		if (field) {
			return { field: field.name, values: [...previous.ids] };
		}
	}
	return undefined;
}

/**
 * A `PAGESIZE` clause value parsed from the builder's number input. `undefined` means "emit no clause":
 * a blank input, or anything that isn't a positive integer (negative, zero, or non-numeric), so a
 * click can never assemble an invalid or pointless `PAGESIZE`.
 */
export function parsePageSizeInput(raw: string): number | undefined {
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) {
		return undefined;
	}
	const value = Number(trimmed);
	return value > 0 ? value : undefined;
}

/**
 * The VQL boolean operator emitted between every WHERE row — `AND` requires all rows, `OR` any. One
 * global choice governs the whole list so the generated VQL needs no parentheses (per-row connectors
 * and nested groups are a deferred advanced-logic enhancement).
 */
export type FilterMatch = 'AND' | 'OR';

/**
 * One WHERE filter row: a field, an operator valid for that field's type, and a value. `value` holds
 * a single-value operator's text; `values` holds the entries of a `CONTAINS` list. `fieldType` is the
 * raw Vault `type` token used to decide value quoting. Any part may be absent while the user is still
 * filling the row — an incomplete row contributes nothing to the assembled clause.
 */
export interface BuilderFilterRow {
	field?: string;
	fieldType?: string;
	operator?: FilterOperator;
	value?: string;
	values?: readonly string[];
}

/** The WHERE builder state: the global match mode and the ordered filter rows. */
export interface BuilderWhere {
	match: FilterMatch;
	rows: readonly BuilderFilterRow[];
}

/** SPEC rows whose values are string literals in VQL and so must be single-quoted. Date and DateTime
 *  literals are quoted too — VQL requires them wrapped in single quotes (e.g. `'2024-01-01'`,
 *  `'2024-01-01T00:00:00.000Z'`). Only Number and Boolean emit bare. */
const QUOTED_FILTER_ROWS: ReadonlySet<QueryFilterFieldType> = new Set<QueryFilterFieldType>([
	'String',
	'Object',
	'Picklist',
	'Date',
	'DateTime',
	'Default',
]);

/**
 * Render a single filter value as VQL, quoting text-shaped and date-shaped field types (String,
 * Object/ID, Picklist, Date, DateTime, and the permissive Default); Number and Boolean emit bare. The
 * value is trimmed; a quoted value has its backslashes and single quotes escaped so the literal stays
 * well-formed.
 */
export function quoteFilterValue(fieldType: string | undefined, raw: string): string {
	const trimmed = raw.trim();
	if (!QUOTED_FILTER_ROWS.has(resolveFilterFieldType(fieldType))) {
		return trimmed;
	}
	const escaped = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
	return `'${escaped}'`;
}

/** Render one filter row as a VQL condition, or `undefined` when the row is too incomplete to emit
 *  (no field, no operator, or no non-blank value). */
function renderFilterRow(row: BuilderFilterRow): string | undefined {
	if (!row.field || !row.operator) {
		return undefined;
	}
	if (row.operator === 'CONTAINS') {
		const entries = (row.values ?? [])
			.filter((entry) => entry.trim().length > 0)
			.map((entry) => quoteFilterValue(row.fieldType, entry));
		return entries.length > 0 ? `${row.field} CONTAINS (${entries.join(', ')})` : undefined;
	}
	if (!row.value || row.value.trim().length === 0) {
		return undefined;
	}
	return `${row.field} ${row.operator} ${quoteFilterValue(row.fieldType, row.value)}`;
}

/**
 * Assemble the WHERE rows into a condition string (without the `WHERE` keyword), joining complete rows
 * with the chosen `AND`/`OR` operator. Incomplete rows are skipped so a half-filled row never breaks
 * the query. Returns `undefined` when no row is complete, so the caller emits no clause.
 */
export function assembleWhereConditions(where: BuilderWhere): string | undefined {
	const conditions = where.rows
		.map(renderFilterRow)
		.filter((condition): condition is string => condition !== undefined);
	if (conditions.length === 0) {
		return undefined;
	}
	return conditions.join(` ${where.match} `);
}

/**
 * One inbound-relationship subquery block: the child relationship name and the chosen child field API
 * `name`s in pick order. Emitted as `(SELECT <fields> FROM <relationship>)`; a block with no non-blank
 * field contributes nothing to the SELECT list.
 */
export interface BuilderSubquery {
	relationship: string;
	fields: readonly string[];
}

/** The minimally-valid panel state the Builder assembles into a query. */
export interface BuilderQuerySelection {
	/** The `FROM` object's API `name`, or `undefined` while none is picked. */
	object?: string;
	/** The `SELECT` field API `name`s, in pick order (= emitted order); includes dotted outbound
	 *  traversal fields (`relationship.field`) as peers of plain fields. */
	fields: readonly string[];
	/** Inbound-relationship subquery blocks, appended last in the SELECT list in creation order. */
	subqueries?: readonly BuilderSubquery[];
	/** The WHERE builder state, or `undefined` for no filters. */
	where?: BuilderWhere;
	/** The `PAGESIZE` value, or `undefined` to emit no `PAGESIZE` clause (see {@link parsePageSizeInput}). */
	pageSize?: number;
}

/** Render one inbound subquery block as `(SELECT … FROM <relationship>)`, dropping blank field entries;
 *  `undefined` when the block has no non-blank field (so it emits nothing). */
function renderSubquery(subquery: BuilderSubquery): string | undefined {
	const fields = subquery.fields.filter((field) => field.trim().length > 0);
	if (fields.length === 0) {
		return undefined;
	}
	return `(SELECT ${fields.join(', ')} FROM ${subquery.relationship})`;
}

/**
 * The full SELECT list in emitted order: plain + dotted outbound fields (in pick order) first, then
 * every non-empty inbound subquery block last.
 */
function selectClauseParts(selection: BuilderQuerySelection): string[] {
	const subqueries = (selection.subqueries ?? [])
		.map(renderSubquery)
		.filter((part): part is string => part !== undefined);
	return [...selection.fields, ...subqueries];
}

/** True once the selection can assemble a runnable query: a `FROM` object and ≥1 SELECT output (a
 *  plain/outbound field or a non-empty inbound subquery block). */
export function isBuilderQueryReady(selection: BuilderQuerySelection): boolean {
	return !!selection.object && selectClauseParts(selection).length > 0;
}

/**
 * Why "Build Query in Editor" is disabled, as a tooltip naming the single next thing to supply, or
 * `undefined` once the selection is ready. `FROM` is reported before `SELECT` so the message tracks
 * the order the user fills the panel top-down.
 */
export function builderBuildBlockedReason(selection: BuilderQuerySelection): string | undefined {
	if (!selection.object) {
		return 'Choose an object in the From field first.';
	}
	if (selectClauseParts(selection).length === 0) {
		return 'Add at least one field to Select.';
	}
	return undefined;
}

/**
 * Assemble the panel selection into a complete VQL statement, piped through core {@link formatVql} so
 * the output is byte-identical to Format Document on the same query. Emits
 * `SELECT <fields, subqueries> FROM <object> [WHERE …] [PAGESIZE n]` — no ORDER BY yet. Returns `''` when
 * the selection isn't {@link isBuilderQueryReady ready}, so a caller can never write empty/invalid VQL.
 */
export function assembleBuilderQuery(selection: BuilderQuerySelection): string {
	if (!isBuilderQueryReady(selection)) {
		return '';
	}
	let statement = `SELECT ${selectClauseParts(selection).join(', ')} FROM ${selection.object}`;
	const conditions = selection.where && assembleWhereConditions(selection.where);
	if (conditions) {
		statement += ` WHERE ${conditions}`;
	}
	if (selection.pageSize != null) {
		statement += ` PAGESIZE ${selection.pageSize}`;
	}
	return formatVql(statement);
}
