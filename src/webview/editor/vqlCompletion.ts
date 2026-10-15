import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import type { VaultFieldMeta, VaultObjectSummary, VaultPicklistValue } from '../../core/rest/types';
import { metadataStore } from './metadataStoreSingleton';
import {
	planCompletion,
	type CompletionPlan,
	type VqlToken,
} from '../../core/vql/completionContext';
import {
	buildRelationshipOptions,
	getQueryTargetFromQueryString,
	isInboundRelationship,
	quoteFilterValue,
	relationshipFieldSource,
	RELATIONSHIP_STANDARD_FIELDS,
	type RelationshipTargetResolvers,
} from '../../core/vql/builderPanelState';
import { resolveFilterFieldType } from '../../core/vql/queryFilterOperators';
import {
	VQL_DATE_LITERAL_DOCS,
	VQL_DATE_LITERALS,
	VQL_FUNCTION_DOCS,
	VQL_FUNCTIONS,
	VQL_OPTION_DOCS,
	VQL_OPTIONS,
} from '../../core/vql/vqlKeywords';
import { VQL_LANGUAGE_ID } from './vqlLanguage';

/**
 * Context-aware VQL completion for the Monaco editor. Where the earlier provider offered one
 * flat list everywhere, this reads the token stream to the cursor via the Monarch tokenizer, asks the
 * DOM-free {@link planCompletion} core what belongs at that spot, and resolves the resulting
 * {@link CompletionPlan} into suggestions — pulling targets/fields/relationships/picklist values from
 * the webview {@link metadataStore} (which caches, de-dupes, and resolves field types), so the provider
 * stays async, never fetches or resolves types itself, and never touches Vault directly. The
 * classification logic and its unit tests live in `src/core/vql/completionContext.ts`; this file owns
 * only the Monaco glue and the store reads.
 */

let registered = false;

/** Register the VQL completion provider once per webview load. */
export function registerVqlCompletion(): void {
	if (registered) {
		return;
	}
	registered = true;
	monaco.languages.registerCompletionItemProvider(VQL_LANGUAGE_ID, {
		// A `.` should re-trigger completion so `rel__cr.` immediately offers the standard field set.
		triggerCharacters: ['.'],
		async provideCompletionItems(model, position) {
			const word = model.getWordUntilPosition(position);
			const range: monaco.IRange = {
				startLineNumber: position.lineNumber,
				endLineNumber: position.lineNumber,
				startColumn: word.startColumn,
				endColumn: word.endColumn,
			};
			// Tokenize everything up to the *start* of the in-progress word, so the plan classifies the
			// committed context and the partial word being typed never skews the position.
			const committed = model.getValueInRange({
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: position.lineNumber,
				endColumn: word.startColumn,
			});
			const plan = planCompletion(tokenize(committed));
			// Resolve fields/operators/values against the query's *root* FROM object. No query has run yet
			// (this is completion over in-progress editor text), so there's no queryDescribe to read the
			// target from — `getQueryTargetFromQueryString` strips relationship subqueries (which carry
			// their own FROM) so a subquery never skews which target's metadata completion offers.
			const fromTarget = getQueryTargetFromQueryString(model.getValue());
			const suggestions = await resolvePlan(plan, fromTarget, range);
			return { suggestions };
		},
	});
}

/** Run the Monarch tokenizer over `text` and flatten it into the {@link VqlToken}s the plan reads,
 *  slicing each token's source text from its line by offset. */
function tokenize(text: string): VqlToken[] {
	const lines = text.split('\n');
	const tokens: VqlToken[] = [];
	monaco.editor.tokenize(text, VQL_LANGUAGE_ID).forEach((lineTokens, lineIndex) => {
		const lineText = lines[lineIndex] ?? '';
		lineTokens.forEach((token, i) => {
			const end = i + 1 < lineTokens.length ? lineTokens[i + 1].offset : lineText.length;
			tokens.push({ type: token.type, text: lineText.slice(token.offset, end) });
		});
	});
	return tokens;
}

/** Resolve a {@link CompletionPlan} into Monaco suggestions, fetching only the metadata the plan asks
 *  for. Metadata that needs a `FROM` target but has none is skipped (nothing to fetch against). */
async function resolvePlan(
	plan: CompletionPlan,
	fromTarget: string | undefined,
	range: monaco.IRange,
): Promise<monaco.languages.CompletionItem[]> {
	const suggestions: monaco.languages.CompletionItem[] = [];

	if (plan.relationshipFields) {
		const fields = await relationshipFieldSet(plan.relationshipName, fromTarget);
		for (const field of fields) {
			suggestions.push(relationshipFieldItem(field, range));
		}
	}
	if (plan.targets) {
		for (const target of await metadataStore.getTargets()) {
			suggestions.push(targetItem(target, range));
		}
	}
	if (plan.fields && fromTarget) {
		for (const field of await metadataStore.getFields(fromTarget)) {
			suggestions.push(fieldItem(field, range));
		}
	}
	if (plan.relationshipNames && fromTarget) {
		for (const item of await outboundRelationshipItems(fromTarget, range)) {
			suggestions.push(item);
		}
	}
	if (plan.operatorsForField !== undefined && fromTarget) {
		for (const item of await operatorItems(plan.operatorsForField, fromTarget, range)) {
			suggestions.push(item);
		}
	}
	if (plan.valuesForField !== undefined && fromTarget) {
		for (const item of await valueItems(plan.valuesForField, fromTarget, range)) {
			suggestions.push(item);
		}
	}
	if (plan.functions) {
		for (const name of VQL_FUNCTIONS) {
			suggestions.push(functionItem(name, range));
		}
	}
	if (plan.options) {
		for (const name of VQL_OPTIONS) {
			if (VQL_OPTION_DOCS[name].context === plan.options) {
				suggestions.push(optionItem(name, range));
			}
		}
	}
	for (const keyword of plan.keywords) {
		suggestions.push(keywordItem(keyword, range));
	}
	return suggestions;
}

/** Store-backed target resolvers for the shared relationship-field seam — the completion mirror of the
 *  Query Builder's `targetResolvers`. Each reads the live snapshot, so a fetch that lands mid-resolution
 *  (e.g. a special target's `SHOW FIELDS`) is reflected. */
function completionTargetResolvers(): RelationshipTargetResolvers {
	return {
		fieldsOf: (target) => metadataStore.getSnapshot().index.fieldsFor(target),
		labelOf: (target) =>
			metadataStore.getSnapshot().index.objectSummaries().find((summary) => summary.name === target)
				?.label,
		isConfigurableObject: (target) =>
			metadataStore.getSnapshot().index.isConfigurableObject(target),
	};
}

/** The field set to offer after `<relationship>.`, resolved through the shared {@link buildRelationshipOptions}
 *  seam so completion and the Query Builder agree exactly: document/configurable-object relationships from
 *  the hardcoded tables (no fetch), and special query-only targets (absent from `/metadata/vobjects`, e.g.
 *  attachments/signatures/jobs) from their real `SHOW FIELDS`. Falls back to the standard set when the
 *  relationship can't be resolved (no `FROM` target, or the name isn't among the target's relationships). */
async function relationshipFieldSet(
	relationshipName: string | undefined,
	fromTarget: string | undefined,
): Promise<ReadonlyArray<{ name: string; label: string }>> {
	const fallback = RELATIONSHIP_STANDARD_FIELDS.map((field) => ({
		name: field.name,
		label: field.label,
	}));
	if (!relationshipName || !fromTarget) {
		return fallback;
	}
	const relationships = await metadataStore.getRelationships(fromTarget);
	const relationship = relationships.find((candidate) => candidate.name === relationshipName);
	if (!relationship) {
		return fallback;
	}
	// Load the discriminator set (so a real object keeps the table) and — only for a special target —
	// its real fields, the inputs the shared seam reads off the snapshot. Awaiting here is what makes the
	// dynamic path work in a one-shot completion (the Builder pre-warms these via effects instead).
	await metadataStore.getConfigurableObjects();
	const isConfigurable = (target: string): boolean =>
		metadataStore.getSnapshot().index.isConfigurableObject(target);
	if (relationshipFieldSource(relationship, isConfigurable) === 'dynamic') {
		await metadataStore.getFields(relationship.target);
	}
	return buildRelationshipOptions([relationship], completionTargetResolvers()).map((option) => ({
		name: option.fieldName,
		label: option.fieldLabel,
	}));
}

/** The outbound (parent-traversal) relationships of `target`, as distinct-kind suggestions that insert
 *  the relationship name for the user to follow with a `.`. Inbound relationships get no v1 completion. */
async function outboundRelationshipItems(
	target: string,
	range: monaco.IRange,
): Promise<monaco.languages.CompletionItem[]> {
	const relationships = await metadataStore.getRelationships(target);
	return relationships
		.filter((relationship) => !isInboundRelationship(relationship))
		.map((relationship) => ({
			label: relationship.name,
			kind: monaco.languages.CompletionItemKind.Reference,
			insertText: relationship.name,
			detail: `→ ${relationship.target}`,
			range,
		}));
}

/** The filter operators valid for `field`'s type, as suggestions — the store owns the "picklist index
 *  outranks the SHOW type" resolution (a dotted/unknown field falls back to the Default row). */
async function operatorItems(
	field: string,
	target: string,
	range: monaco.IRange,
): Promise<monaco.languages.CompletionItem[]> {
	const operators = await metadataStore.getOperatorsFor(target, field);
	return operators.map((operator) => ({
		label: operator,
		kind: monaco.languages.CompletionItemKind.Operator,
		insertText: operator,
		range,
	}));
}

/** The value suggestions for `field`, by resolved type: picklist values (label shown, `name` written),
 *  boolean literals for a Boolean field, or relative date literals for Date/DateTime fields. `null` is
 *  a valid value for every field type, so it is always offered. Free-text and number values are typed
 *  by hand. */
async function valueItems(
	field: string,
	target: string,
	range: monaco.IRange,
): Promise<monaco.languages.CompletionItem[]> {
	const fieldType = await metadataStore.getFieldType(target, field);
	const items: monaco.languages.CompletionItem[] = [];
	const filterType = resolveFilterFieldType(fieldType);
	if (fieldType === 'Picklist') {
		const picklistName = metadataStore.getSnapshot().index.picklistNameFor(target, field);
		if (picklistName) {
			const values = await metadataStore.getPicklistValues(picklistName);
			items.push(...values.map((value) => picklistValueItem(value, range)));
		}
	} else if (filterType === 'Boolean') {
		items.push(...['true', 'false'].map((literal) => literalValueItem(literal, range)));
	} else if (filterType === 'Date' || filterType === 'DateTime') {
		items.push(...VQL_DATE_LITERALS.map((name) => dateLiteralItem(name, range)));
	}
	// `null` tests for the presence/absence of a value on any field type (`WHERE {field} = null`).
	items.push(literalValueItem('null', range));
	return items;
}

function targetItem(
	target: VaultObjectSummary,
	range: monaco.IRange,
): monaco.languages.CompletionItem {
	return {
		label: target.name,
		kind: monaco.languages.CompletionItemKind.Class,
		insertText: target.name,
		detail: target.label,
		range,
	};
}

function fieldItem(field: VaultFieldMeta, range: monaco.IRange): monaco.languages.CompletionItem {
	return {
		label: field.name,
		kind: monaco.languages.CompletionItemKind.Field,
		insertText: field.name,
		detail: field.type,
		range,
	};
}

/** A related target's field, offered after `rel__cr.` (from the standard table for a real object, or the
 *  target's real `SHOW FIELDS` for a special query-only target). */
function relationshipFieldItem(
	field: { name: string; label: string },
	range: monaco.IRange,
): monaco.languages.CompletionItem {
	return {
		label: field.name,
		kind: monaco.languages.CompletionItemKind.Field,
		insertText: field.name,
		detail: field.label,
		range,
	};
}

/** A picklist value: the human `label` is shown, the VQL-safe (quoted) `name` is written. */
function picklistValueItem(
	value: VaultPicklistValue,
	range: monaco.IRange,
): monaco.languages.CompletionItem {
	return {
		label: value.label ?? value.name,
		kind: monaco.languages.CompletionItemKind.EnumMember,
		insertText: quoteFilterValue('Picklist', value.name),
		filterText: `${value.name} ${value.label ?? ''}`,
		detail: value.name,
		range,
	};
}

function keywordItem(keyword: string, range: monaco.IRange): monaco.languages.CompletionItem {
	return {
		label: keyword,
		kind: monaco.languages.CompletionItemKind.Keyword,
		insertText: keyword,
		range,
	};
}

/** A literal value (`true`/`false`/`null`): shown and inserted verbatim, lowercase per the VQL docs. */
function literalValueItem(literal: string, range: monaco.IRange): monaco.languages.CompletionItem {
	return {
		label: literal,
		kind: monaco.languages.CompletionItemKind.Value,
		insertText: literal,
		range,
	};
}

/** A VQL function, inserted as a `FN(…)` call template with the cursor placed inside the parentheses. */
function functionItem(name: string, range: monaco.IRange): monaco.languages.CompletionItem {
	const doc = VQL_FUNCTION_DOCS[name];
	return {
		label: name,
		kind: monaco.languages.CompletionItemKind.Function,
		insertText: `${name}($1)`,
		insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
		detail: doc.summary,
		documentation: `${doc.summary} (${doc.since})`,
		range,
	};
}

/** A VQL query-target option / search scope (`ALLVERSIONS`, `SCOPE`, …), inserted as the plain word. */
function optionItem(name: string, range: monaco.IRange): monaco.languages.CompletionItem {
	const doc = VQL_OPTION_DOCS[name];
	return {
		label: name,
		kind: monaco.languages.CompletionItemKind.Keyword,
		insertText: name,
		detail: doc.summary,
		documentation: `${doc.summary} (${doc.since})`,
		range,
	};
}

/** A relative date literal offered as a WHERE value. Literals that take a count insert a `:n` snippet
 *  placeholder (`DAYS_AGO:${1:n}`); `TODAY` inserts as the bare word. */
function dateLiteralItem(name: string, range: monaco.IRange): monaco.languages.CompletionItem {
	const doc = VQL_DATE_LITERAL_DOCS[name];
	const insertText = doc.takesCount ? `${name}:\${1:n}` : name;
	return {
		label: name,
		kind: monaco.languages.CompletionItemKind.Constant,
		insertText,
		insertTextRules: doc.takesCount
			? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
			: undefined,
		detail: doc.summary,
		documentation: `${doc.summary} (${doc.since})`,
		range,
	};
}
