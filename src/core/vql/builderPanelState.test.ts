import { describe, it, expect } from 'vitest';
import type { VaultFieldMeta, VaultObjectSummary } from '../rest/types';
import {
	assembleBuilderQuery,
	assembleWhereConditions,
	buildRelationshipOptions,
	builderBuildBlockedReason,
	deriveBuilderBody,
	isBuilderQueryReady,
	isInboundRelationship,
	outboundFieldExpression,
	parsePageSizeInput,
	planPreviousResultsFilter,
	quoteFilterValue,
	getQueryTargetFromQueryString,
	relationshipFieldOptions,
	relationshipFieldSource,
	isWhereFilterableType,
	whereFilterableFields,
	RELATIONSHIP_STANDARD_FIELDS,
	RELATIONSHIP_DOCUMENT_FIELDS,
	type BuilderFilterRow,
	type MetadataResource,
	type RelationshipTargetResolvers,
} from './builderPanelState';
import type { VaultRelationshipMeta } from '../rest/types';
import { resolveFilterFieldType } from './queryFilterOperators';
import { formatVql } from './vqlFormat';
import relationshipCorpus from './fixtures/relationshipCorpus.json';

const idle: MetadataResource<VaultObjectSummary[]> = { status: 'idle' };
const loading: MetadataResource<VaultObjectSummary[]> = { status: 'loading' };
const errored: MetadataResource<VaultObjectSummary[]> = { status: 'error' };
const loaded = (data: VaultObjectSummary[]): MetadataResource<VaultObjectSummary[]> => ({
	status: 'loaded',
	data,
});

const person: VaultObjectSummary = { name: 'person__sys', label: 'Person' };

/** Build a full {@link RelationshipTargetResolvers} from partial overrides — defaults resolve to no
 *  fields, no labels, and nothing configurable (so an un-overridden relationship classifies `dynamic`). */
const resolvers = (
	overrides: Partial<RelationshipTargetResolvers> = {},
): RelationshipTargetResolvers => ({
	fieldsOf: () => [],
	labelOf: () => undefined,
	isConfigurableObject: () => false,
	...overrides,
});

describe('deriveBuilderBody', () => {
	it('gates every not-connected status when nothing is loaded', () => {
		expect(deriveBuilderBody('disconnected', idle)).toBe('gated');
		expect(deriveBuilderBody('connecting', idle)).toBe('gated');
		expect(deriveBuilderBody('error', idle)).toBe('gated');
	});

	it('shows loading while connected and targets are idle (pre-warm about to fire)', () => {
		expect(deriveBuilderBody('connected', idle)).toBe('loading');
	});

	it('shows loading while connected and targets are in flight', () => {
		expect(deriveBuilderBody('connected', loading)).toBe('loading');
	});

	it('shows error when connected and SHOW TARGETS failed', () => {
		expect(deriveBuilderBody('connected', errored)).toBe('error');
	});

	it('shows ready when targets loaded with rows', () => {
		expect(deriveBuilderBody('connected', loaded([person]))).toBe('ready');
	});

	it('shows empty when targets loaded with zero rows', () => {
		expect(deriveBuilderBody('connected', loaded([]))).toBe('empty');
	});

	it('gates on a mid-session connection drop even with a previously-loaded target list', () => {
		// Connection status outranks a stale load — a disconnected/errored Vault must never leave a
		// previously-fetched target list pickable (see
		// docs/defects/query-builder-target-selectable-after-disconnect.md).
		expect(deriveBuilderBody('disconnected', loaded([person]))).toBe('gated');
		expect(deriveBuilderBody('error', loaded([person]))).toBe('gated');
	});

	it('gates a zero-row load too once disconnected', () => {
		expect(deriveBuilderBody('disconnected', loaded([]))).toBe('gated');
	});
});

describe('parsePageSizeInput', () => {
	it('is undefined for a blank input (no clause)', () => {
		expect(parsePageSizeInput('')).toBeUndefined();
		expect(parsePageSizeInput('   ')).toBeUndefined();
	});

	it('parses a positive integer', () => {
		expect(parsePageSizeInput('100')).toBe(100);
		expect(parsePageSizeInput(' 25 ')).toBe(25);
	});

	it('is undefined for zero, negatives, and non-integers', () => {
		expect(parsePageSizeInput('0')).toBeUndefined();
		expect(parsePageSizeInput('-5')).toBeUndefined();
		expect(parsePageSizeInput('1.5')).toBeUndefined();
		expect(parsePageSizeInput('abc')).toBeUndefined();
	});
});

describe('isBuilderQueryReady / builderBuildBlockedReason', () => {
	it('is not ready without an object', () => {
		const selection = { object: undefined, fields: ['name__v'] };
		expect(isBuilderQueryReady(selection)).toBe(false);
		expect(builderBuildBlockedReason(selection)).toMatch(/object/i);
	});

	it('is not ready without any field', () => {
		const selection = { object: 'person__sys', fields: [] };
		expect(isBuilderQueryReady(selection)).toBe(false);
		expect(builderBuildBlockedReason(selection)).toMatch(/field/i);
	});

	it('reports the missing object before the missing field', () => {
		expect(builderBuildBlockedReason({ object: undefined, fields: [] })).toMatch(/object/i);
	});

	it('is ready with an object and at least one field', () => {
		const selection = { object: 'person__sys', fields: ['name__v'] };
		expect(isBuilderQueryReady(selection)).toBe(true);
		expect(builderBuildBlockedReason(selection)).toBeUndefined();
	});

	it('is ready with only a non-empty inbound subquery block (no plain fields)', () => {
		const selection = {
			object: 'person__sys',
			fields: [],
			subqueries: [{ relationship: 'children__cr', fields: ['id'] }],
		};
		expect(isBuilderQueryReady(selection)).toBe(true);
		expect(builderBuildBlockedReason(selection)).toBeUndefined();
	});

	it('is not ready when the only subquery block is empty', () => {
		const selection = {
			object: 'person__sys',
			fields: [],
			subqueries: [{ relationship: 'children__cr', fields: [] }],
		};
		expect(isBuilderQueryReady(selection)).toBe(false);
		expect(builderBuildBlockedReason(selection)).toMatch(/field/i);
	});
});

describe('assembleBuilderQuery', () => {
	it('assembles SELECT fields (in pick order) FROM object, formatVql-formatted', () => {
		expect(
			assembleBuilderQuery({ object: 'person__sys', fields: ['name__v', 'id'] }),
		).toBe('SELECT\n    name__v,\n    id\nFROM person__sys');
	});

	it('appends PAGESIZE when a value is given, and omits it when absent', () => {
		expect(assembleBuilderQuery({ object: 'person__sys', fields: ['id'], pageSize: 10 })).toBe(
			'SELECT\n    id\nFROM person__sys\nPAGESIZE 10',
		);
		expect(assembleBuilderQuery({ object: 'person__sys', fields: ['id'] })).not.toMatch(/PAGESIZE/);
	});

	it('returns empty string when the selection is not buildable', () => {
		expect(assembleBuilderQuery({ object: undefined, fields: ['id'] })).toBe('');
		expect(assembleBuilderQuery({ object: 'person__sys', fields: [] })).toBe('');
	});

	it('inserts a WHERE clause between FROM and PAGESIZE', () => {
		expect(
			assembleBuilderQuery({
				object: 'person__sys',
				fields: ['id'],
				pageSize: 5,
				where: {
					match: 'AND',
					rows: [{ field: 'name__v', fieldType: 'String', operator: '=', value: 'McNulty' }],
				},
			}),
		).toBe("SELECT\n    id\nFROM person__sys\nWHERE name__v = 'McNulty'\nPAGESIZE 5");
	});

	it('omits WHERE when no row is complete', () => {
		expect(
			assembleBuilderQuery({
				object: 'person__sys',
				fields: ['id'],
				where: {
					match: 'AND',
					rows: [{ field: 'name__v', fieldType: 'String', operator: '=', value: '   ' }],
				},
			}),
		).not.toMatch(/WHERE/);
	});

	it('keeps dotted outbound fields inline in SELECT pick order', () => {
		expect(
			assembleBuilderQuery({
				object: 'object__v',
				fields: ['id', 'name__v', 'stage__sysr.name__v'],
			}),
		).toBe('SELECT\n    id,\n    name__v,\n    stage__sysr.name__v\nFROM object__v');
	});

	it('appends inbound subquery blocks last, formatted multi-line', () => {
		expect(
			assembleBuilderQuery({
				object: 'object__v',
				fields: ['id', 'name__v', 'stage__sysr.name__v'],
				subqueries: [{ relationship: 'rl_related_inbound__cr', fields: ['id', 'name__v'] }],
			}),
		).toBe(
			[
				'SELECT',
				'    id,',
				'    name__v,',
				'    stage__sysr.name__v,',
				'    (',
				'        SELECT',
				'            id,',
				'            name__v',
				'        FROM rl_related_inbound__cr',
				'    )',
				'FROM object__v',
			].join('\n'),
		);
	});

	it('orders multiple subquery blocks after all fields, in creation order', () => {
		const vql = assembleBuilderQuery({
			object: 'object__v',
			fields: ['id'],
			subqueries: [
				{ relationship: 'a__cr', fields: ['id'] },
				{ relationship: 'b__cr', fields: ['name__v'] },
			],
		});
		expect(vql.indexOf('FROM a__cr')).toBeLessThan(vql.indexOf('FROM b__cr'));
		expect(vql.indexOf('id')).toBeLessThan(vql.indexOf('FROM a__cr'));
	});

	it('drops empty subquery blocks from the SELECT list', () => {
		expect(
			assembleBuilderQuery({
				object: 'object__v',
				fields: ['id'],
				subqueries: [{ relationship: 'empty__cr', fields: ['  ', ''] }],
			}),
		).toBe('SELECT\n    id\nFROM object__v');
	});
});

describe('relationship classification', () => {
	it('classifies inbound vs outbound case-insensitively, defaulting non-inbound to outbound', () => {
		expect(isInboundRelationship({ type: 'inbound' })).toBe(true);
		expect(isInboundRelationship({ type: 'INBOUND' })).toBe(true);
		expect(isInboundRelationship({ type: 'outbound' })).toBe(false);
		expect(isInboundRelationship({ type: 'weird' })).toBe(false);
	});

	it('builds the parent-traversal expression as relationship.field', () => {
		expect(outboundFieldExpression('stage__sysr', 'name__v')).toBe('stage__sysr.name__v');
	});
});

describe('relationshipFieldOptions (dynamic, from the target real fields)', () => {
	const manufacturer: VaultRelationshipMeta = {
		name: 'manufacturer__cr',
		target: 'manufacturer__c',
		type: 'outbound',
	};

	it('returns no options for an empty (unloaded / zero / failed) field list', () => {
		expect(relationshipFieldOptions(manufacturer, [], 'Manufacturer')).toEqual([]);
	});

	it('maps each real field to an option with the row label format', () => {
		const [option] = relationshipFieldOptions(
			manufacturer,
			[{ name: 'code__c', type: 'String', label: 'Code' }],
			'Manufacturer',
		);
		expect(option).toEqual({
			relationship: 'manufacturer__cr',
			target: 'manufacturer__c',
			targetLabel: 'Manufacturer',
			inbound: false,
			fieldName: 'code__c',
			fieldLabel: 'Code',
			fieldType: 'String',
			label: 'Manufacturer (manufacturer__cr): Code (code__c)',
		});
	});

	it('falls back to the target API name when no target label is given', () => {
		const [option] = relationshipFieldOptions(manufacturer, [
			{ name: 'code__c', type: 'String', label: 'Code' },
		]);
		expect(option.targetLabel).toBe('manufacturer__c');
		expect(option.label).toBe('manufacturer__c (manufacturer__cr): Code (code__c)');
	});

	it('falls back the field label to its API name when the field has no label', () => {
		const [option] = relationshipFieldOptions(manufacturer, [{ name: 'code__c', type: 'String' }]);
		expect(option.fieldLabel).toBe('code__c');
		expect(option.label).toBe('manufacturer__c (manufacturer__cr): code__c (code__c)');
	});

	it('preserves the inbound flag from the relationship type', () => {
		const inbound: VaultRelationshipMeta = {
			name: 'approved_countries__cr',
			target: 'approved_country__c',
			type: 'inbound',
		};
		const [option] = relationshipFieldOptions(inbound, [{ name: 'name__v', type: 'String' }]);
		expect(option.inbound).toBe(true);
	});

	it('carries the raw Vault type so a lowercase id resolves like an uppercase ID', () => {
		const lower = relationshipFieldOptions(manufacturer, [{ name: 'attachment_id__sys', type: 'id' }]);
		const upper = relationshipFieldOptions(manufacturer, [{ name: 'id', type: 'ID' }]);
		expect(resolveFilterFieldType(lower[0].fieldType)).toBe('Object');
		expect(resolveFilterFieldType(lower[0].fieldType)).toBe(resolveFilterFieldType(upper[0].fieldType));
	});
});

describe('buildRelationshipOptions (dynamic, per target)', () => {
	it('builds each relationship from its own target real fields, resolving the label', () => {
		const relationships: VaultRelationshipMeta[] = [
			{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
			{ name: 'approved_countries__cr', target: 'approved_country__c', type: 'inbound' },
		];
		const fieldsByTarget: Record<string, VaultFieldMeta[]> = {
			manufacturer__c: [{ name: 'code__c', type: 'String', label: 'Code' }],
			approved_country__c: [
				{ name: 'iso__c', type: 'String', label: 'ISO' },
				{ name: 'region__c', type: 'String', label: 'Region' },
			],
		};
		const options = buildRelationshipOptions(
			relationships,
			resolvers({
				fieldsOf: (target) => fieldsByTarget[target] ?? [],
				labelOf: (target) => (target === 'manufacturer__c' ? 'Manufacturer' : undefined),
			}),
		);

		expect(options.map((option) => `${option.relationship}:${option.fieldName}`)).toEqual([
			'manufacturer__cr:code__c',
			'approved_countries__cr:iso__c',
			'approved_countries__cr:region__c',
		]);
		expect(options[0].targetLabel).toBe('Manufacturer');
		expect(options[1].targetLabel).toBe('approved_country__c');
	});

	it('offers the real attachment fields (no id / name__v) so the subquery Vault accepts', () => {
		// The original bug: attachment targets have `attachment_id__sys`/`file_name__sys`, not `id`.
		const attachment: VaultRelationshipMeta = {
			name: 'attachments__sysr',
			target: 'attachment_object__sys',
			type: 'inbound',
		};
		const attachmentFields: VaultFieldMeta[] = [
			{ name: 'attachment_id__sys', type: 'id', label: 'ID' },
			{ name: 'file_name__sys', type: 'String', label: 'File Name' },
			{ name: 'object_record_id__sys', type: 'id', label: 'Object Record' },
		];
		const options = buildRelationshipOptions(
			[attachment],
			resolvers({
				fieldsOf: (target) => (target === 'attachment_object__sys' ? attachmentFields : []),
			}),
		);

		const fieldNames = options.map((option) => option.fieldName);
		expect(fieldNames).toEqual(['attachment_id__sys', 'file_name__sys', 'object_record_id__sys']);
		expect(fieldNames).not.toContain('id');
		expect(fieldNames).not.toContain('name__v');

		const vql = assembleBuilderQuery({
			object: 'rl_parent__c',
			fields: ['id'],
			subqueries: [{ relationship: 'attachments__sysr', fields: fieldNames }],
		});
		expect(vql).toContain('FROM attachments__sysr');
		expect(vql).toContain('attachment_id__sys');
		expect(vql).not.toContain('name__v');
	});

	it('picks the attachment field set from the reported target, not the relationship name', () => {
		// Same relationship name (`attachments__sysr`), different reported target → different fields, with
		// no `document_`-name branching. Document attachments expose `document_id__sys`; object ones don't.
		const objectFields: VaultFieldMeta[] = [{ name: 'object_record_id__sys', type: 'id' }];
		const documentFields: VaultFieldMeta[] = [{ name: 'document_id__sys', type: 'id' }];
		const fieldsOf = (target: string): VaultFieldMeta[] =>
			target === 'attachment_object__sys'
				? objectFields
				: target === 'attachment_doc__sys'
					? documentFields
					: [];

		const fromObject = buildRelationshipOptions(
			[{ name: 'attachments__sysr', target: 'attachment_object__sys', type: 'inbound' }],
			resolvers({ fieldsOf }),
		);
		const fromDocument = buildRelationshipOptions(
			[{ name: 'attachments__sysr', target: 'attachment_doc__sys', type: 'inbound' }],
			resolvers({ fieldsOf }),
		);

		expect(fromObject.map((option) => option.fieldName)).toEqual(['object_record_id__sys']);
		expect(fromDocument.map((option) => option.fieldName)).toEqual(['document_id__sys']);
	});

	it('builds an outbound traversal option from the parent target real fields', () => {
		const [option] = buildRelationshipOptions(
			[{ name: 'owner__sysr', target: 'user__sys', type: 'outbound' }],
			resolvers({ fieldsOf: () => [{ name: 'username__sys', type: 'String', label: 'User Name' }] }),
		);
		expect(option.inbound).toBe(false);
		expect(outboundFieldExpression(option.relationship, option.fieldName)).toBe(
			'owner__sysr.username__sys',
		);
	});

	it('builds a self-reference from the object own fields (a legitimate self-join keeps working)', () => {
		const userFields: VaultFieldMeta[] = [
			{ name: 'username__sys', type: 'String' },
			{ name: 'manager__sys', type: 'id' },
		];
		const options = buildRelationshipOptions(
			[{ name: 'users__sysr', target: 'user__sys', type: 'inbound' }],
			resolvers({ fieldsOf: (target) => (target === 'user__sys' ? userFields : []) }),
		);
		expect(options.map((option) => option.fieldName)).toEqual(['username__sys', 'manager__sys']);
		expect(options.every((option) => option.inbound)).toBe(true);
	});
});

describe('relationshipFieldSource (hybrid: tables for configurable-object/document, fetch for special)', () => {
	const configurable =
		(names: readonly string[]) =>
		(target: string): boolean =>
			names.includes(target);

	it('routes a relationship whose target is the documents object to the hardcoded document table', () => {
		expect(
			relationshipFieldSource(
				{ name: 'related_docs__cr', target: 'documents', type: 'outbound' },
				configurable([]),
			),
		).toBe('document');
	});

	it('routes a `document_`-prefixed name to a special (non-vobject) target to dynamic, not the document table', () => {
		// The bug fix: `document_signature__sysr → document_signature__sys` is a special subquery-only
		// target absent from /metadata/vobjects, so it resolves its real fields — the `document_` name
		// prefix alone is not enough; the target must also be a configurable object.
		expect(
			relationshipFieldSource(
				{ name: 'document_signature__sysr', target: 'document_signature__sys', type: 'inbound' },
				configurable([]),
			),
		).toBe('dynamic');
	});

	it('routes an inbound `document_`-prefixed relationship to a configurable object to the document table', () => {
		// The inbound-document-cross-reference fix: `document_batch_number__vr → batch__v` reports a
		// misleading self-target (Vault's own `SHOW RELATIONSHIPS` quirk), but the subquery really traverses
		// to `documents` — confirmed live against `test__c`'s `document_test_object__cr` (see
		// docs/defects/vql-builder-inbound-document-relationship-misroutes-object-fields.md).
		expect(
			relationshipFieldSource(
				{ name: 'document_batch_number__vr', target: 'batch__v', type: 'inbound' },
				configurable(['batch__v']),
			),
		).toBe('document');
	});

	it('leaves the outbound direction of a `document_`-prefixed relationship on the standard table', () => {
		// From `documents`' own SHOW RELATIONSHIPS, this same relationship name reports its target
		// correctly, and a dot-lookup against the standard table already succeeds there — only the inbound
		// direction has the misleading-target quirk.
		expect(
			relationshipFieldSource(
				{ name: 'document_country1__cr', target: 'country__v', type: 'outbound' },
				configurable(['country__v']),
			),
		).toBe('object');
	});

	it('routes a relationship to a configurable object to the hardcoded standard table', () => {
		expect(
			relationshipFieldSource(
				{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' },
				configurable(['manufacturer__c']),
			),
		).toBe('object');
	});

	it('routes a special subquery-only target (absent from /metadata/vobjects) to dynamic resolution', () => {
		expect(
			relationshipFieldSource(
				{ name: 'attachments__sysr', target: 'attachment_object__sys', type: 'inbound' },
				configurable(['rl_parent__c']),
			),
		).toBe('dynamic');
	});

	it('routes a queryable-but-non-configurable target (in SHOW TARGETS, not a vobject) to dynamic', () => {
		// job_instance__sys is a query target yet absent from /metadata/vobjects, so it must NOT get the
		// standard table (it lacks name__v/status__v) — the bug this discriminator change fixes.
		expect(
			relationshipFieldSource(
				{ name: 'job__sysr', target: 'job_instance__sys', type: 'inbound' },
				configurable(['user__sys']),
			),
		).toBe('dynamic');
	});

	it('routes a system-source configurable object (e.g. user__sys) to the standard table', () => {
		expect(
			relationshipFieldSource(
				{ name: 'owner__sysr', target: 'user__sys', type: 'outbound' },
				configurable(['user__sys']),
			),
		).toBe('object');
	});

	it('routes a genuine self-reference (no `document_` prefix) to the standard table, not the document table', () => {
		// users__sysr → user__sys is a real self-reference, not a document-cross-reference — it must not be
		// swept up by the inbound+configurable branch just because it's inbound to a configurable object.
		expect(
			relationshipFieldSource(
				{ name: 'users__sysr', target: 'user__sys', type: 'inbound' },
				configurable(['user__sys']),
			),
		).toBe('object');
	});

	it('routes a binders relationship (absent from /metadata/vobjects, not caught as a document) to dynamic', () => {
		expect(
			relationshipFieldSource(
				{ name: 'binder_nodes__sysr', target: 'binders', type: 'inbound' },
				configurable([]),
			),
		).toBe('dynamic');
	});
});

describe('buildRelationshipOptions hybrid sourcing', () => {
	const failIfFetched = (): never => {
		throw new Error('a table-backed relationship must not fetch fields');
	};

	it('expands an object relationship from the standard table without fetching', () => {
		const options = buildRelationshipOptions(
			[{ name: 'manufacturer__cr', target: 'manufacturer__c', type: 'outbound' }],
			resolvers({
				fieldsOf: failIfFetched,
				labelOf: () => 'Manufacturer',
				isConfigurableObject: (target) => target === 'manufacturer__c',
			}),
		);
		expect(options.map((option) => option.fieldName)).toEqual(
			RELATIONSHIP_STANDARD_FIELDS.map((field) => field.name),
		);
		expect(options[0]).toMatchObject({ fieldName: 'id', targetLabel: 'Manufacturer' });
		expect(resolveFilterFieldType(options[0].fieldType)).toBe('Object');
	});

	it('expands a document relationship from the document table without fetching', () => {
		const options = buildRelationshipOptions(
			[{ name: 'related_docs__cr', target: 'documents', type: 'outbound' }],
			resolvers({ fieldsOf: failIfFetched }),
		);
		expect(options.map((option) => option.fieldName)).toEqual(
			RELATIONSHIP_DOCUMENT_FIELDS.map((field) => field.name),
		);
		expect(options.map((option) => option.fieldName)).toContain('title__v');
	});

	it('expands a special (non-configurable) target from its dynamically fetched real fields', () => {
		const options = buildRelationshipOptions(
			[{ name: 'attachments__sysr', target: 'attachment_object__sys', type: 'inbound' }],
			resolvers({
				fieldsOf: (target) =>
					target === 'attachment_object__sys'
						? [{ name: 'attachment_id__sys', type: 'id', label: 'ID' }]
						: [],
				isConfigurableObject: (target) => target === 'rl_parent__c',
			}),
		);
		expect(options.map((option) => option.fieldName)).toEqual(['attachment_id__sys']);
		expect(options.map((option) => option.fieldName)).not.toContain('name__v');
	});

	it('expands a queryable-but-non-configurable target from real fields, not the standard table', () => {
		// job_instance__sys is listed by SHOW TARGETS but is not a vobject; it must expand from its real
		// fields and never offer standard-table fields it lacks (name__v/status__v).
		const options = buildRelationshipOptions(
			[{ name: 'job__sysr', target: 'job_instance__sys', type: 'inbound' }],
			resolvers({
				fieldsOf: (target) =>
					target === 'job_instance__sys'
						? [{ name: 'job_name__sys', type: 'String', label: 'Job Name' }]
						: [],
				isConfigurableObject: (target) => target === 'user__sys',
			}),
		);
		expect(options.map((option) => option.fieldName)).toEqual(['job_name__sys']);
		expect(options.map((option) => option.fieldName)).not.toContain('name__v');
		expect(options.map((option) => option.fieldName)).not.toContain('status__v');
	});
});

describe('isWhereFilterableType / whereFilterableFields', () => {
	// Verified live: Vault rejects `WHERE <field> = 'x'` (and LIKE) on LongText and RichText fields
	// with "[LongText]/[RichText] field [...] is not supported with operator [...]", while SELECT of the
	// same field succeeds — so the WHERE picker must hide them though the SELECT picker keeps them.
	it('rejects LongText and RichText (case-insensitively)', () => {
		expect(isWhereFilterableType('LongText')).toBe(false);
		expect(isWhereFilterableType('richtext')).toBe(false);
		expect(isWhereFilterableType('RICHTEXT')).toBe(false);
	});

	it('allows every other type, and treats a missing type as filterable', () => {
		expect(isWhereFilterableType('String')).toBe(true);
		expect(isWhereFilterableType('DateTime')).toBe(true);
		expect(isWhereFilterableType('Object')).toBe(true);
		expect(isWhereFilterableType(undefined)).toBe(true);
	});

	it('drops LongText/RichText rows from a field list while preserving order of the rest', () => {
		const fields: VaultFieldMeta[] = [
			{ name: 'name__v', type: 'String' },
			{ name: 'notes__c', type: 'LongText' },
			{ name: 'created_date__v', type: 'DateTime' },
			{ name: 'body__c', type: 'RichText' },
		];
		expect(whereFilterableFields(fields)).toEqual([
			{ name: 'name__v', type: 'String' },
			{ name: 'created_date__v', type: 'DateTime' },
		]);
	});
});

describe('quoteFilterValue', () => {
	it('single-quotes text-shaped rows (String, Object, Picklist, Default)', () => {
		expect(quoteFilterValue('String', 'McNulty')).toBe("'McNulty'");
		expect(quoteFilterValue('ObjectReference', '00P000')).toBe("'00P000'");
		expect(quoteFilterValue('Picklist', 'active__c')).toBe("'active__c'");
		expect(quoteFilterValue('LongText', 'note')).toBe("'note'");
	});

	it('single-quotes Date and DateTime literals (VQL requires them quoted)', () => {
		expect(quoteFilterValue('Date', '2024-01-01')).toBe("'2024-01-01'");
		expect(quoteFilterValue('DateTime', '2024-01-01T00:00:00.000Z')).toBe(
			"'2024-01-01T00:00:00.000Z'",
		);
	});

	it('leaves numbers and booleans bare', () => {
		expect(quoteFilterValue('Number', '25')).toBe('25');
		expect(quoteFilterValue('Currency', '9.99')).toBe('9.99');
		expect(quoteFilterValue('Boolean', 'true')).toBe('true');
	});

	it('trims surrounding whitespace before emitting', () => {
		expect(quoteFilterValue('String', '  McNulty  ')).toBe("'McNulty'");
		expect(quoteFilterValue('Number', '  25  ')).toBe('25');
	});

	it('escapes backslashes and single quotes inside a quoted value', () => {
		expect(quoteFilterValue('String', "D'Angelo")).toBe("'D\\'Angelo'");
		expect(quoteFilterValue('String', 'a\\b')).toBe("'a\\\\b'");
	});

	it('emits an empty quoted string for a blank text value, and bare for a blank numeric', () => {
		expect(quoteFilterValue('String', '')).toBe("''");
		expect(quoteFilterValue('String', '   ')).toBe("''");
		expect(quoteFilterValue('Number', '   ')).toBe('');
	});
});

describe('assembleWhereConditions', () => {
	const string = (value: string): BuilderFilterRow => ({
		field: 'name__v',
		fieldType: 'String',
		operator: '=',
		value,
	});

	it('is undefined when there are no rows', () => {
		expect(assembleWhereConditions({ match: 'AND', rows: [] })).toBeUndefined();
	});

	it('joins complete rows with AND', () => {
		expect(
			assembleWhereConditions({
				match: 'AND',
				rows: [
					{ field: 'name__v', fieldType: 'String', operator: '=', value: 'McNulty' },
					{ field: 'status__v', fieldType: 'Picklist', operator: '!=', value: 'active__c' },
				],
			}),
		).toBe("name__v = 'McNulty' AND status__v != 'active__c'");
	});

	it('joins complete rows with OR', () => {
		expect(
			assembleWhereConditions({
				match: 'OR',
				rows: [string('McNulty'), { field: 'age__v', fieldType: 'Number', operator: '>', value: '30' }],
			}),
		).toBe("name__v = 'McNulty' OR age__v > 30");
	});

	it('single-quotes a DateTime filter end-to-end (regression: bare value was invalid VQL)', () => {
		expect(
			assembleWhereConditions({
				match: 'AND',
				rows: [
					{
						field: 'created_date__v',
						fieldType: 'DateTime',
						operator: '<',
						value: '2026-09-24T12:39:00.000Z',
					},
				],
			}),
		).toBe("created_date__v < '2026-09-24T12:39:00.000Z'");
	});

	it('skips incomplete rows (missing field, operator, or value)', () => {
		expect(
			assembleWhereConditions({
				match: 'AND',
				rows: [
					{ field: undefined, operator: '=', value: 'x' },
					{ field: 'name__v', operator: undefined, value: 'x' },
					{ field: 'name__v', fieldType: 'String', operator: '=', value: '' },
					string('McNulty'),
				],
			}),
		).toBe("name__v = 'McNulty'");
	});

	it('emits CONTAINS as a parenthesized, per-type-quoted list', () => {
		expect(
			assembleWhereConditions({
				match: 'AND',
				rows: [
					{
						field: 'status__v',
						fieldType: 'Picklist',
						operator: 'CONTAINS',
						values: ['active__c', 'inactive__c'],
					},
				],
			}),
		).toBe("status__v CONTAINS ('active__c', 'inactive__c')");
	});

	it('drops blank CONTAINS entries and skips the row when none remain', () => {
		expect(
			assembleWhereConditions({
				match: 'AND',
				rows: [
					{ field: 'age__v', fieldType: 'Number', operator: 'CONTAINS', values: ['25', '  ', '30'] },
					{ field: 'status__v', fieldType: 'Picklist', operator: 'CONTAINS', values: ['   ', ''] },
				],
			}),
		).toBe('age__v CONTAINS (25, 30)');
	});
});

describe('getQueryTargetFromQueryString', () => {
	it('reads the root FROM object of a simple query', () => {
		expect(getQueryTargetFromQueryString('SELECT id, name__v FROM product__v')).toBe('product__v');
	});

	it('is case- and whitespace-insensitive', () => {
		expect(getQueryTargetFromQueryString('select id\n  from   Order__v  where x = 1')).toBe('Order__v');
	});

	it('ignores a relationship subquery FROM and returns the outer object', () => {
		const vql =
			'SELECT id, (SELECT id, name__v FROM contacts__cr) FROM account__v WHERE status__v = 1';
		expect(getQueryTargetFromQueryString(vql)).toBe('account__v');
	});

	it('returns undefined when there is no FROM clause', () => {
		expect(getQueryTargetFromQueryString('SHOW TARGETS')).toBeUndefined();
	});
});

describe('planPreviousResultsFilter', () => {
	const relationships: VaultRelationshipMeta[] = [
		{ name: 'account__cr', target: 'account__v', type: 'outbound' },
		{ name: 'children__cr', target: 'child__c', type: 'inbound' },
	];
	const fields: VaultFieldMeta[] = [
		{ name: 'name__v', label: 'Name', type: 'String' },
		{ name: 'account__c', label: 'Account', type: 'Object', relationship_name: 'account__cr' },
	];

	it('plans a CONTAINS filter on the reference field pointing at the previous target', () => {
		const plan = planPreviousResultsFilter(relationships, fields, {
			target: 'account__v',
			ids: ['a1', 'a2'],
		});
		expect(plan).toEqual({ field: 'account__c', values: ['a1', 'a2'] });
	});

	it('returns undefined when no outbound relationship targets the previous object', () => {
		expect(
			planPreviousResultsFilter(relationships, fields, { target: 'unrelated__v', ids: ['x'] }),
		).toBeUndefined();
	});

	it('does not use an inbound relationship even when its target matches', () => {
		expect(
			planPreviousResultsFilter(relationships, fields, { target: 'child__c', ids: ['c1'] }),
		).toBeUndefined();
	});

	it('returns undefined when the previous result set is empty or absent', () => {
		expect(
			planPreviousResultsFilter(relationships, fields, { target: 'account__v', ids: [] }),
		).toBeUndefined();
		expect(planPreviousResultsFilter(relationships, fields, undefined)).toBeUndefined();
	});

	it('returns undefined when no field cross-references the matching relationship', () => {
		const withoutRefField: VaultFieldMeta[] = [{ name: 'name__v', label: 'Name', type: 'String' }];
		expect(
			planPreviousResultsFilter(relationships, withoutRefField, {
				target: 'account__v',
				ids: ['a1'],
			}),
		).toBeUndefined();
	});
});

/**
 * Golden regression suite seeded from `fixtures/relationshipCorpus.json` — the distilled, offline
 * form of the live-vault validation (823/857 relationship queries OK, 0 `SHOW FIELDS` failures; see
 * `docs/research/vql-builder-relationship-field-resolution.md`). Each case carries the exact VQL that was
 * built from the target's **real** `SHOW FIELDS` and run against a live Vault (v26.2), plus its verdict.
 *
 * Two axes, matching the SPEC's Testing Decisions:
 *  - **Dynamic-path golden tests** feed a relationship its target's real fields and assert the shared
 *    option builder + query assembly reproduce the exact VQL Vault accepted. This is the durable form of
 *    the live validation, which ran the dynamic path for every `(parent, relationship)` pair.
 *  - **Classifier-routing guards** exercise the production `buildRelationshipOptions` seam with realistic
 *    `/metadata/vobjects` membership and assert the *field names it emits* — real fields for a special
 *    subquery-only target, the standard-table subset for a configurable object — so a regression that
 *    reintroduces a hardcoded field set for a special target fails deterministically.
 */
interface CorpusField {
	name: string;
	type: string;
	label?: string;
}
interface CorpusCase {
	parent: string;
	relationship: string;
	target: string;
	type: string;
	inbound: boolean;
	note: string;
	validatedVql: string;
	verdict: 'SUCCESS' | 'FAILURE';
	error?: string;
}
interface RelationshipCorpus {
	targets: Record<string, CorpusField[]>;
	cases: CorpusCase[];
}

const corpus = relationshipCorpus as unknown as RelationshipCorpus;
const successCases = corpus.cases.filter((corpusCase) => corpusCase.verdict === 'SUCCESS');
const failureCases = corpus.cases.filter((corpusCase) => corpusCase.verdict === 'FAILURE');
const caseLabel = (corpusCase: CorpusCase): string =>
	`${corpusCase.parent} / ${corpusCase.relationship} — ${corpusCase.note}`;

/**
 * The corpus targets that are real **configurable objects** (present in `GET /metadata/vobjects`): the
 * standard/custom/system objects that carry the hardcoded standard field set. Every other target in the
 * corpus is a special, subquery-only target (attachment/signature/workflow-job) that must resolve its
 * real `SHOW FIELDS` instead. This mirrors the `isConfigurableObject` predicate the webview feeds the
 * classifier, so the routing guards below match how the real Builder classifies each relationship.
 */
const CONFIGURABLE_OBJECTS: ReadonlySet<string> = new Set([
	'user__sys',
	'batch__v',
	'country__v',
	'rl_parent__c',
]);

/** The real fields a corpus target reports, as {@link VaultFieldMeta} (its `SHOW FIELDS` rows). */
const realFieldsOf = (target: string): VaultFieldMeta[] => corpus.targets[target] ?? [];

/** The related target's API names, in `SHOW FIELDS` order. */
const realFieldNamesOf = (target: string): string[] =>
	realFieldsOf(target).map((field) => field.name);

const relationshipOf = (corpusCase: CorpusCase): VaultRelationshipMeta => ({
	name: corpusCase.relationship,
	target: corpusCase.target,
	type: corpusCase.type,
});

/** Locate a corpus case by its `(relationship, target)`, failing loudly if the fixture no longer has it. */
function requireCase(relationship: string, target: string): CorpusCase {
	const found = corpus.cases.find(
		(corpusCase) => corpusCase.relationship === relationship && corpusCase.target === target,
	);
	expect(found, `corpus is missing the ${relationship} → ${target} case`).toBeDefined();
	return found!;
}

/**
 * Assemble the VQL from a corpus target's **real** fields through the shared {@link relationshipFieldOptions}
 * seam — an inbound case as a `(SELECT … FROM rel)` subquery over every real field (the panel's "select
 * all"), an outbound case as the `<relationship>.id` traversal chip the live evidence recorded. `id` on the
 * parent SELECT mirrors every validated query's root projection. This is the dynamic path the live
 * validation exercised, independent of how the hybrid classifier would route the relationship.
 */
function assembleFromRealFields(corpusCase: CorpusCase): string {
	const relationship = relationshipOf(corpusCase);
	const options = relationshipFieldOptions(relationship, realFieldsOf(corpusCase.target));
	if (isInboundRelationship(relationship)) {
		return assembleBuilderQuery({
			object: corpusCase.parent,
			fields: ['id'],
			subqueries: [
				{ relationship: corpusCase.relationship, fields: options.map((option) => option.fieldName) },
			],
			pageSize: 1,
		});
	}
	const idOption = options.find((option) => option.fieldName === 'id');
	expect(idOption, `outbound corpus target ${corpusCase.target} is missing a real 'id' field`).toBeDefined();
	return assembleBuilderQuery({
		object: corpusCase.parent,
		fields: [outboundFieldExpression(corpusCase.relationship, idOption!.fieldName)],
		pageSize: 1,
	});
}

/** The field names the production `buildRelationshipOptions` seam emits for a relationship, classified
 *  from the real `/metadata/vobjects` membership in {@link CONFIGURABLE_OBJECTS}. */
function builderFieldNames(relationship: VaultRelationshipMeta): string[] {
	return buildRelationshipOptions([relationship], {
		fieldsOf: realFieldsOf,
		labelOf: () => undefined,
		isConfigurableObject: (target) => CONFIGURABLE_OBJECTS.has(target),
	}).map((option) => option.fieldName);
}

describe('relationship corpus — the dynamic path reproduces every live-validated query', () => {
	it('covers all six SUCCESS and four FAILURE variants (fixture drift guard)', () => {
		// Silently dropping a case must fail here, not just thin the suite.
		expect(successCases).toHaveLength(6);
		expect(failureCases).toHaveLength(4);
	});

	for (const corpusCase of successCases) {
		it(`SUCCESS builds exactly the Vault-accepted VQL: ${caseLabel(corpusCase)}`, () => {
			// `formatVql` is what `assembleBuilderQuery` pipes through, so a match proves the field set and
			// order are identical to the single-line VQL Vault accepted, not merely whitespace-equivalent.
			expect(assembleFromRealFields(corpusCase)).toBe(formatVql(corpusCase.validatedVql));
		});
	}

	for (const corpusCase of failureCases) {
		it(`FAILURE still emits the Vault-rejected VQL (out-of-scope gap): ${caseLabel(corpusCase)}`, () => {
			// Even built from the target's real fields, these are rejected by Vault — a `SHOW RELATIONSHIPS`
			// metadata quirk (misleading self-target / non-traversable lookup), not a `SHOW FIELDS` problem,
			// and already broken in v1. Pinning the exact emitted VQL keeps a future fix a deliberate change.
			expect(assembleFromRealFields(corpusCase)).toBe(formatVql(corpusCase.validatedVql));
			expect(corpusCase.error).toBeTruthy();
		});
	}
});

describe('relationship corpus — the hybrid classifier routes each relationship to the right source', () => {
	it('routes special subquery-only targets to their real fields, never the standard/document table', () => {
		// The attachment (object + document) and workflow-job children are absent from `/metadata/vobjects`,
		// so the classifier must resolve their real `SHOW FIELDS`, not fall back to a hardcoded table.
		const specialCases = [
			requireCase('attachments__sysr', 'attachment_object__sys'),
			requireCase('attachments__sysr', 'attachment_doc__sys'),
			requireCase('active_workflow_jobs__sysr', 'active_workflow_job__sys'),
		];
		for (const corpusCase of specialCases) {
			const names = builderFieldNames(relationshipOf(corpusCase));
			expect(names).toEqual(realFieldNamesOf(corpusCase.target));
			// `name__v` is a standard-table field; a special target reintroducing it means a hardcoded regression.
			expect(names).not.toContain('name__v');
		}
	});

	it('offers the real object-attachment fields with no `id` — the original bug', () => {
		const names = builderFieldNames(relationshipOf(requireCase('attachments__sysr', 'attachment_object__sys')));
		expect(names).toContain('attachment_id__sys');
		expect(names).toContain('file_name__sys');
		// The motivating failure: the attachment target has no `id`/`name__v` the hardcoded table assumed.
		expect(names).not.toContain('id');
		expect(names).not.toContain('name__v');
	});

	it('splits document vs object attachment fields from the reported target alone', () => {
		const objectAttachment = builderFieldNames(relationshipOf(requireCase('attachments__sysr', 'attachment_object__sys')));
		const documentAttachment = builderFieldNames(relationshipOf(requireCase('attachments__sysr', 'attachment_doc__sys')));
		// Same relationship name, different reported target → different fields, no `document_`-name branching.
		expect(documentAttachment).toContain('document_id__sys');
		expect(objectAttachment).not.toContain('document_id__sys');
		expect(objectAttachment).toContain('object_record_id__sys');
		expect(documentAttachment).not.toContain('object_record_id__sys');
	});

	it('keeps a configurable-object self-reference on the standard table — a Vault-accepted subset', () => {
		// The genuine self-join `user__sys / users__sysr` classifies `object`; the standard table it expands
		// from is not byte-equal to the 60-field validated VQL, but every field it offers is one the target's
		// real schema has (so Vault accepts it) — the SPEC's subset rule for object/document relationships.
		const selfRef = requireCase('users__sysr', 'user__sys');
		const names = builderFieldNames(relationshipOf(selfRef));
		const realNames = new Set(realFieldNamesOf(selfRef.target));
		expect(names).toEqual(RELATIONSHIP_STANDARD_FIELDS.map((field) => field.name));
		expect(names.every((name) => realNames.has(name))).toBe(true);
	});

	it('routes document_signature__sysr to its real fields, not the document table (defect fix)', () => {
		// The classifier keys the `document` source on `target === 'documents'`, not the `document_` name
		// prefix. document_signature__sysr's real target (document_signature__sys) is a special subquery-only
		// target absent from /metadata/vobjects, so it resolves its own `SHOW FIELDS` — matching the SUCCESS
		// golden test's dynamic path. (Was previously misrouted to RELATIONSHIP_DOCUMENT_FIELDS; see
		// docs/defects/vql-builder-document-prefix-misroutes-special-targets.md.)
		const signature = requireCase('document_signature__sysr', 'document_signature__sys');
		const names = builderFieldNames(relationshipOf(signature));
		expect(names).toEqual(realFieldNamesOf(signature.target));
		expect(names).not.toEqual(RELATIONSHIP_DOCUMENT_FIELDS.map((field) => field.name));
	});

	it('routes the inbound document-cross-reference class to the document table (defect fix)', () => {
		// document_batch_number__vr → batch__v: inbound, `document_`-prefixed, target IS a real vobject —
		// Vault's SHOW RELATIONSHIPS misreports `target` as `batch__v` itself, but the subquery really
		// traverses to `documents` (confirmed live against test__c's document_test_object__cr; see
		// docs/defects/vql-builder-inbound-document-relationship-misroutes-object-fields.md). The corpus's
		// own FAILURE case for this relationship fails on `created_date__v` — a RELATIONSHIP_STANDARD_FIELDS
		// field absent from the document table — confirming the standard table was always wrong here.
		const crossRef = requireCase('document_batch_number__vr', 'batch__v');
		const names = builderFieldNames(relationshipOf(crossRef));
		expect(names).toEqual(RELATIONSHIP_DOCUMENT_FIELDS.map((field) => field.name));
	});

	it('leaves the outbound document-cross-reference direction on the standard table (unaffected by the fix)', () => {
		// document_batch_number__vr from binders, outbound: same relationship name and reported target
		// (`batch__v`) as the inbound case above, but Vault already rejects this direction with `Invalid
		// lookup relationship` regardless of field source, so it must stay routed by plain target identity
		// rather than being swept into the inbound-only fix. `requireCase` can't disambiguate two cases
		// sharing a (relationship, target) pair, so this looks up by `parent` directly.
		const outboundCrossRef = corpus.cases.find(
			(corpusCase) =>
				corpusCase.relationship === 'document_batch_number__vr' && corpusCase.parent === 'binders',
		);
		expect(outboundCrossRef, 'corpus is missing the binders / document_batch_number__vr case').toBeDefined();
		const names = builderFieldNames(relationshipOf(outboundCrossRef!));
		expect(names).toEqual(RELATIONSHIP_STANDARD_FIELDS.map((field) => field.name));
	});
});
