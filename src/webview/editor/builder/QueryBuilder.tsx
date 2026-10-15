import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	assembleBuilderQuery,
	buildRelationshipOptions,
	builderBuildBlockedReason,
	deriveBuilderBody,
	isBuilderQueryReady,
	outboundFieldExpression,
	parsePageSizeInput,
	planPreviousResultsFilter,
	relationshipFieldSource,
	whereFilterableFields,
	type BuilderWhere,
	type FilterMatch,
	type PreviousResults,
	type PreviousResultsFilterPlan,
	type RelationshipFieldOption,
	type RelationshipTargetResolvers,
} from '../../../core/vql/builderPanelState';
import type { ConnectionSnapshot } from '../../../shared/vqlProtocol';
import { metadataStore } from '../metadataStoreSingleton';
import { useMetadata } from '../useMetadata';
import { CaretRightIcon } from '../../shell/icons';
import { Spinner } from '../Spinner';
import { FieldCombobox } from './FieldCombobox';
import { FromCombobox } from './FromCombobox';
import { WhereBuilder, type WhereFieldResolver, type WhereRowState } from './WhereBuilder';

/** One inbound-relationship subquery block being edited: the relationship, its target's label (for the
 *  header), and the chosen child field names in pick order. */
interface SubqueryBlockState {
	relationship: string;
	targetLabel: string;
	fields: string[];
}

interface Props {
	connection?: ConnectionSnapshot;
	/** Overwrite the Monaco buffer with an assembled query and move focus there (see VqlEditor). */
	onBuildQuery(vql: string): void;
	/** The previous query's object + result ids, enabling the "filter by previous results" shortcut. */
	previousResults?: PreviousResults;
}

/**
 * The Query Builder panel shell: a collapsible region between the header and the Monaco buffer,
 * collapsed by default so text-first users pay zero footprint. It renders identically in both
 * surfaces (narrow sidebar, popped-out editor tab). The region is always present; only its body
 * varies by connection + metadata-load state (see {@link deriveBuilderBody}).
 *
 * The panel is a thin reader over the webview {@link MetadataStore}: all metadata fetching, caching,
 * de-dup, and the vault-change reset live in the store (read here via {@link useMetadata}), so this
 * component owns only builder *selection* state (the picked object, SELECT chips, WHERE rows, PAGESIZE).
 * The body walks the clause stack top-down: a `FROM` combobox over pre-warmed `SHOW TARGETS`; once an
 * object is picked and its `SHOW FIELDS` load lands, a `SELECT` field combobox with a chip tray, a
 * `WHERE` filter builder, a `PAGESIZE` input, and a "Build Query in Editor" button that assembles the
 * selection and overwrites the Monaco buffer.
 */
export function QueryBuilder({ connection, onBuildQuery, previousResults }: Props): JSX.Element {
	const snap = useMetadata();
	const [expanded, setExpanded] = useState(false);
	const [selected, setSelected] = useState<string>();
	// The SELECT field names in pick order (= emitted order), and the raw PAGESIZE input.
	const [selectedFields, setSelectedFields] = useState<string[]>([]);
	const [pageSizeInput, setPageSizeInput] = useState('');
	// WHERE builder state: the global match mode and the ordered filter rows (with stable ids).
	const [whereMatch, setWhereMatch] = useState<FilterMatch>('AND');
	const [whereRows, setWhereRows] = useState<WhereRowState[]>([]);
	const nextRowId = useRef(0);
	// The accumulating inbound subquery blocks (SELECT's relationship-expanded picks).
	const [subqueries, setSubqueries] = useState<SubqueryBlockState[]>([]);

	const status = connection?.status ?? 'disconnected';
	// The vault DNS identifies the connected Vault; `undefined` while not connected.
	const vaultDns = connection?.vaultDns;
	const loadedVault = useRef<string>();

	// The metadata reads for the current selection, off the store snapshot.
	const loadedTargets = snap.index.objectSummaries();
	const fieldMeta = selected ? snap.index.fieldsFor(selected) : [];
	// The WHERE picker offers only fields VQL can filter on; SELECT keeps the full `fieldMeta` list.
	const whereFields = whereFilterableFields(fieldMeta);
	const relationships = selected ? snap.index.relationshipsFor(selected) : [];

	// Reset only builder *selection* when connected to a genuinely different vault (the store owns the
	// metadata reset). A mid-session drop leaves `vaultDns` undefined — skip it so the loaded selection
	// survives per the connection-dropped state; reconnecting to the same vault is a no-op too.
	useEffect(() => {
		if (!vaultDns || vaultDns === loadedVault.current) {
			return;
		}
		loadedVault.current = vaultDns;
		setSelected(undefined);
		setSelectedFields([]);
		setPageSizeInput('');
		setWhereRows([]);
		setWhereMatch('AND');
		setSubqueries([]);
	}, [vaultDns]);

	// Picking a new FROM object (or clearing it — an empty name) clears all field-dependent selection
	// (SELECT chips, WHERE rows, and inbound subquery blocks) and asks the store to load the new object's
	// fields/relationships/picklists. Re-picking the same object is a no-op.
	const onSelectTarget = useCallback(
		(name: string) => {
			if (name === (selected ?? '')) {
				return;
			}
			const next = name || undefined;
			setSelected(next);
			setSelectedFields([]);
			setWhereRows([]);
			setWhereMatch('AND');
			setSubqueries([]);
			if (next) {
				void metadataStore.getFields(next).catch(() => undefined);
				void metadataStore.getRelationships(next);
				void metadataStore.getPicklistFields(next);
			}
		},
		[selected],
	);

	// When exactly one query target exists, pick it automatically so the user drops straight into field
	// selection. Reads the store snapshot and routes through the same select handler as a manual pick.
	useEffect(() => {
		if (snap.targetsStatus() === 'loaded' && loadedTargets.length === 1 && !selected) {
			onSelectTarget(loadedTargets[0].name);
		}
	}, [snap, loadedTargets, selected, onSelectTarget]);

	const addField = useCallback((name: string) => {
		setSelectedFields((current) => (current.includes(name) ? current : [...current, name]));
	}, []);

	const removeField = useCallback((name: string) => {
		setSelectedFields((current) => current.filter((field) => field !== name));
	}, []);

	const clearFields = useCallback(() => {
		setSelectedFields([]);
	}, []);

	const addWhereRow = useCallback(() => {
		const id = nextRowId.current++;
		setWhereRows((current) => [...current, { id, value: '', values: [] }]);
	}, []);

	// Append a WHERE row pre-filled from the previous query's results: the reference field pointing at
	// the previous target, `CONTAINS`, and the prior result ids as multi-values.
	const addPreviousResultsRow = useCallback((plan: PreviousResultsFilterPlan) => {
		const id = nextRowId.current++;
		setWhereRows((current) => [
			...current,
			{ id, field: plan.field, operator: 'CONTAINS', value: '', values: [...plan.values] },
		]);
	}, []);

	const removeWhereRow = useCallback((id: number) => {
		setWhereRows((current) => current.filter((row) => row.id !== id));
	}, []);

	const changeWhereRow = useCallback(
		(id: number, patch: Partial<WhereRowState>) => {
			// Picking a picklist field triggers its lazy value load in the store (de-duped there), so the
			// dropdown is populated by the time the user reaches the value widget.
			if (patch.field && selected) {
				const picklist = snap.index.picklistNameFor(selected, patch.field);
				if (picklist) {
					void metadataStore.getPicklistValues(picklist);
				}
			}
			setWhereRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
		},
		[selected, snap],
	);

	// An inbound pick accumulates the child field into that relationship's subquery block (creating the
	// block on the first pick); re-picking the same field is a no-op.
	const addInboundField = useCallback((option: RelationshipFieldOption) => {
		setSubqueries((current) => {
			const existing = current.find((block) => block.relationship === option.relationship);
			if (!existing) {
				return [
					...current,
					{
						relationship: option.relationship,
						targetLabel: option.targetLabel,
						fields: [option.fieldName],
					},
				];
			}
			if (existing.fields.includes(option.fieldName)) {
				return current;
			}
			return current.map((block) =>
				block.relationship === option.relationship
					? { ...block, fields: [...block.fields, option.fieldName] }
					: block,
			);
		});
	}, []);

	const removeInboundField = useCallback((relationship: string, fieldName: string) => {
		setSubqueries((current) =>
			current
				.map((block) =>
					block.relationship === relationship
						? { ...block, fields: block.fields.filter((field) => field !== fieldName) }
						: block,
				)
				// Drop a block once its last field is removed, so no empty subquery lingers.
				.filter((block) => block.fields.length > 0),
		);
	}, []);

	// Clearing a whole subquery block drops it outright — an emptied block is filtered out anyway.
	const clearInboundBlock = useCallback((relationship: string) => {
		setSubqueries((current) => current.filter((block) => block.relationship !== relationship));
	}, []);

	// An outbound pick adds a dotted `relationship.field` chip to the SELECT tray; an inbound pick goes
	// to its subquery block (see addInboundField).
	const onPickRelationship = useCallback(
		(option: RelationshipFieldOption) => {
			if (option.inbound) {
				addInboundField(option);
			} else {
				addField(outboundFieldExpression(option.relationship, option.fieldName));
			}
		},
		[addInboundField, addField],
	);

	// The target-metadata resolvers the option builder needs, bundled: real fields from the store
	// snapshot, the `SHOW TARGETS` human label, and `/metadata/vobjects` membership. A target absent from
	// `/metadata/vobjects` is a query-only target (attachments, signatures, jobs, workflows, binders, …)
	// that must resolve its own fields; real configurable objects keep the stable hardcoded tables.
	const targetResolvers = useMemo<RelationshipTargetResolvers>(
		() => ({
			fieldsOf: (target) => snap.index.fieldsFor(target),
			labelOf: (target) => loadedTargets.find((summary) => summary.name === target)?.label,
			isConfigurableObject: (target) => snap.isConfigurableObject(target),
		}),
		[snap, loadedTargets],
	);

	// The special (dynamic-sourced) relationships — the only ones that need a `SHOW FIELDS` fetch and the
	// only ones that can show a loading affordance. Object/document relationships expand from the tables.
	const dynamicRelationships = useMemo(
		() =>
			relationships.filter(
				(relationship) =>
					relationshipFieldSource(relationship, targetResolvers.isConfigurableObject) === 'dynamic',
			),
		[relationships, targetResolvers],
	);

	// Pre-load only those special targets' real fields — a normal object with many (object/document)
	// relationships stays fetch-free. The store de-dupes and caches; a target that fails to load
	// (offline, permissions, error) degrades to an empty option set for that relationship.
	useEffect(() => {
		for (const relationship of dynamicRelationships) {
			void metadataStore.getFields(relationship.target).catch(() => undefined);
		}
	}, [dynamicRelationships]);

	const relationshipOptions = useMemo(
		() => buildRelationshipOptions(relationships, targetResolvers),
		[relationships, targetResolvers],
	);

	// A transient affordance while a special target's fields are still in flight, so an as-yet-empty
	// options list reads as "loading," not "no related fields."
	const relationshipFieldsLoading = useMemo(
		() => dynamicRelationships.some((relationship) => snap.fieldsStatus(relationship.target) === 'loading'),
		[dynamicRelationships, snap],
	);

	const isRelationshipOptionPicked = useCallback(
		(option: RelationshipFieldOption): boolean =>
			option.inbound
				? subqueries.some(
						(block) =>
							block.relationship === option.relationship &&
							block.fields.includes(option.fieldName),
					)
				: selectedFields.includes(
						outboundFieldExpression(option.relationship, option.fieldName),
					),
		[subqueries, selectedFields],
	);

	// The "filter by previous results" shortcut: offered only once fields + relationships are loaded and
	// the current object actually references the previous query's target (see planPreviousResultsFilter).
	const previousResultsPlan = useMemo(
		() => planPreviousResultsFilter(relationships, fieldMeta, previousResults),
		[relationships, fieldMeta, previousResults],
	);
	const previousResultsFilter = useMemo(() => {
		if (!previousResultsPlan || !previousResults) {
			return undefined;
		}
		const targetLabel =
			loadedTargets.find((summary) => summary.name === previousResults.target)?.label ??
			previousResults.target;
		const count = previousResultsPlan.values.length;
		return {
			label: `Filter by ${count} ${targetLabel} result${count === 1 ? '' : 's'}`,
			onApply: () => addPreviousResultsRow(previousResultsPlan),
		};
	}, [previousResultsPlan, previousResults, loadedTargets, addPreviousResultsRow]);

	// The store's resolved reads, bound to the current FROM object — one reader for every WHERE row (see
	// WhereFieldResolver). Off a selection they answer inertly, so the composer renders before a pick.
	const fieldResolver = useMemo<WhereFieldResolver>(
		() => ({
			getFieldType: (field) => (selected ? snap.getFieldType(selected, field) : undefined),
			getOperatorsFor: (field) => (selected ? snap.getOperatorsFor(selected, field) : []),
			isPicklist: (field) => (selected ? snap.isPicklist(selected, field) : false),
			getPicklistValues: (field) =>
				selected ? snap.picklistValuesForField(selected, field) : undefined,
		}),
		[snap, selected],
	);

	const where: BuilderWhere = {
		match: whereMatch,
		rows: whereRows.map((row) => ({
			field: row.field,
			fieldType: selected && row.field ? snap.getFieldType(selected, row.field) : undefined,
			operator: row.operator,
			value: row.value,
			values: row.values,
		})),
	};

	const selection = {
		object: selected,
		fields: selectedFields,
		subqueries: subqueries.map((block) => ({
			relationship: block.relationship,
			fields: block.fields,
		})),
		where,
		pageSize: parsePageSizeInput(pageSizeInput),
	};
	const blockedReason = builderBuildBlockedReason(selection);

	// Not memoized: `selection` is a fresh literal each render, so a useCallback here would recompute
	// every render anyway.
	function onBuild(): void {
		const vql = assembleBuilderQuery(selection);
		if (vql) {
			onBuildQuery(vql);
			setExpanded(false);
		}
	}

	const body = deriveBuilderBody(status, {
		status: snap.targetsStatus(),
		data: [...loadedTargets],
	});
	const fieldsStatus = selected ? snap.fieldsStatus(selected) : 'idle';

	return (
		<section className="vt-builder">
			<button
				type="button"
				className="vt-builder-toggle"
				aria-expanded={expanded}
				onClick={() => setExpanded((open) => !open)}
			>
				<span className={`vt-builder-caret${expanded ? ' open' : ''}`}>
					<CaretRightIcon />
				</span>
				<span className="vt-builder-title">Query Builder</span>
			</button>
			{expanded && <div className="vt-builder-body">{renderBody()}</div>}
		</section>
	);

	function renderBody(): JSX.Element {
		if (body === 'gated') {
			return <p className="vt-hint">Connect a Vault environment to build a query.</p>;
		}
		if (body === 'loading') {
			return (
				<div className="vt-builder-loading">
					<Spinner label="Loading query targets" /> Loading query targets…
				</div>
			);
		}
		if (body === 'error') {
			return (
				<div className="vt-builder-control-error">
					<span>Couldn’t load query targets.</span>
					<button
						type="button"
						className="vt-btn secondary"
						onClick={() => void metadataStore.getTargets().catch(() => undefined)}
					>
						Retry
					</button>
				</div>
			);
		}
		if (body === 'empty') {
			return <p className="vt-hint">No query targets available — check your Vault permissions.</p>;
		}
		return (
			<>
				<div className="vt-builder-clause">
					<label className="vt-builder-clause-label" htmlFor="vt-from-listbox">
						Target
					</label>
					<FromCombobox targets={loadedTargets} value={selected} onSelect={onSelectTarget} />
					{selected && renderFieldsStatus()}
				</div>
				{selected && fieldsStatus === 'loaded' && fieldMeta.length > 0 && renderComposer()}
			</>
		);
	}

	function renderComposer(): JSX.Element {
		return (
			<>
				<div className="vt-builder-clause">
					<label className="vt-builder-clause-label" htmlFor="vt-select-listbox">
						Fields
					</label>
					<FieldCombobox
						fields={fieldMeta}
						selected={selectedFields}
						relationshipOptions={relationshipOptions}
						isRelationshipOptionPicked={isRelationshipOptionPicked}
						onPick={addField}
						onRemove={removeField}
						onClearAll={clearFields}
						onPickRelationship={onPickRelationship}
					/>
					{relationshipFieldsLoading && (
						<div className="vt-builder-loading">
							<Spinner label="Loading relationship fields" /> Loading relationship fields…
						</div>
					)}
					{subqueries.length > 0 && (
						<ul className="vt-subquery-list">
							{subqueries.map((block) => (
								<li key={block.relationship} className="vt-subquery-block">
									<div className="vt-subquery-head">
										<span>
											{block.targetLabel} ({block.relationship})
										</span>
										<button
											type="button"
											className="vt-subquery-clear"
											aria-label={`Clear all fields from ${block.relationship}`}
											onClick={() => clearInboundBlock(block.relationship)}
										>
											×
										</button>
									</div>
									<ul className="vt-chip-tray">
										{block.fields.map((name) => (
											<li key={name} className="vt-chip">
												<span className="vt-chip-label">{name}</span>
												<button
													type="button"
													className="vt-chip-remove"
													aria-label={`Remove ${name} from ${block.relationship}`}
													onClick={() => removeInboundField(block.relationship, name)}
												>
													×
												</button>
											</li>
										))}
									</ul>
								</li>
							))}
						</ul>
					)}
				</div>
				<WhereBuilder
					fields={whereFields}
					resolver={fieldResolver}
					match={whereMatch}
					rows={whereRows}
					previousResultsFilter={previousResultsFilter}
					onMatchChange={setWhereMatch}
					onAddRow={addWhereRow}
					onRemoveRow={removeWhereRow}
					onRowChange={changeWhereRow}
				/>
				<div className="vt-builder-clause">
					<label className="vt-builder-clause-label" htmlFor="vt-pagesize">
						Page Size
					</label>
					<input
						id="vt-pagesize"
						type="number"
						min="1"
						className="vt-builder-pagesize"
						placeholder="Default"
						value={pageSizeInput}
						onChange={(event) => setPageSizeInput(event.target.value)}
					/>
				</div>
				{/* The tooltip lives on the wrapper, not the button: a disabled button receives no hover
				    events in the webview's Chromium, so it could never surface what's still missing. */}
				<span className="vt-builder-build" data-tooltip={blockedReason}>
					<button
						type="button"
						className="vt-btn"
						onClick={onBuild}
						disabled={!isBuilderQueryReady(selection)}
					>
						Build Query in Editor
					</button>
				</span>
			</>
		);
	}

	function renderFieldsStatus(): JSX.Element | null {
		if (fieldsStatus === 'loading') {
			return (
				<div className="vt-builder-loading">
					<Spinner label="Loading fields" /> Loading fields…
				</div>
			);
		}
		if (fieldsStatus === 'error') {
			return (
				<div className="vt-builder-control-error">
					<span>Couldn’t load fields.</span>
					<button
						type="button"
						className="vt-btn secondary"
						onClick={() => selected && void metadataStore.getFields(selected).catch(() => undefined)}
					>
						Retry
					</button>
				</div>
			);
		}
		if (fieldsStatus === 'loaded' && fieldMeta.length === 0) {
			return <p className="vt-hint">No fields available for this query target.</p>;
		}
		return null;
	}
}
