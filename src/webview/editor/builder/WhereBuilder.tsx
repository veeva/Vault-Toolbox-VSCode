import type { VaultFieldMeta, VaultPicklistValue } from '../../../core/rest/types';
import type { FilterMatch } from '../../../core/vql/builderPanelState';
import type { FilterOperator } from '../../../core/vql/queryFilterOperators';
import { FilterFieldCombobox } from './FilterFieldCombobox';
import { FilterValueEditor } from './FilterValueEditor';
import { VtSelect, type VtSelectOption } from './VtSelect';

/** One WHERE filter row's editable state, plus a stable `id` for React keys (values may repeat). */
export interface WhereRowState {
	id: number;
	field?: string;
	operator?: FilterOperator;
	value: string;
	values: string[];
}

/** A one-click filter offered when the current object relates to the previous query's results (see
 *  the Query Builder's previous-results detection). Applying it appends a pre-filled `CONTAINS` row. */
export interface PreviousResultsFilter {
	/** Human summary for the button, e.g. "Filter by 42 Product results". */
	label: string;
	onApply(): void;
}

/**
 * The metadata store's resolved reads for one WHERE row's field, pre-bound to the current `FROM`
 * object by the panel. The store owns the "what type / which operators / is it a picklist / which
 * values" join; this component only reads the answers, so it never touches fields or picklist maps.
 */
export interface WhereFieldResolver {
	/** A field's effective type (picklist index outranks the Vault token). */
	getFieldType(field: string): string | undefined;
	/** The filter operators valid for a field's resolved type. */
	getOperatorsFor(field: string): readonly FilterOperator[];
	/** Whether a field is a picklist — drives the value widget (dropdown vs free-text). */
	isPicklist(field: string): boolean;
	/** A picklist field's loaded values, or `undefined` while still loading (or when not a picklist). */
	getPicklistValues(field: string): readonly VaultPicklistValue[] | undefined;
}

interface Props {
	fields: readonly VaultFieldMeta[];
	/** Resolved metadata reads for the current object's fields (see {@link WhereFieldResolver}). */
	resolver: WhereFieldResolver;
	match: FilterMatch;
	rows: readonly WhereRowState[];
	/** Present when the current object can be filtered by the previous query's results. */
	previousResultsFilter?: PreviousResultsFilter;
	onMatchChange(match: FilterMatch): void;
	onAddRow(): void;
	onRemoveRow(id: number): void;
	onRowChange(id: number, patch: Partial<WhereRowState>): void;
}

const MATCH_OPTIONS: readonly FilterMatch[] = ['AND', 'OR'];

/**
 * The WHERE clause group: a flat list of `field / operator / value` rows joined by a global AND/OR
 * toggle that appears only once a second filter is added (a single filter needs no join). Each row's
 * operator menu is filtered to those valid for the chosen field's type, and its value widget matches
 * the type (see {@link FilterValueEditor}). Picking a new field resets that row's
 * operator and value, since both are type-dependent. `+ Add filter` appends a row; a per-row `×` deletes
 * it. When the current object relates to the previous query's results, a "Filter by …" shortcut appends
 * a pre-filled `CONTAINS` row. All state is owned by the parent (so it clears when the `FROM` object
 * changes); this component only renders it and reports edits.
 */
export function WhereBuilder({
	fields,
	resolver,
	match,
	rows,
	previousResultsFilter,
	onMatchChange,
	onAddRow,
	onRemoveRow,
	onRowChange,
}: Props): JSX.Element {
	return (
		<div className="vt-builder-clause">
			<div className="vt-builder-clause-head">
				<span className="vt-builder-clause-label">Where</span>
				{rows.length > 1 && (
					<div className="vt-viewtoggle" role="group" aria-label="Match filters">
						{MATCH_OPTIONS.map((option) => (
							<button
								type="button"
								key={option}
								className={`vt-viewtab${match === option ? ' active' : ''}`}
								aria-pressed={match === option}
								onClick={() => onMatchChange(option)}
							>
								{option}
							</button>
						))}
					</div>
				)}
			</div>
			{rows.map((row) => {
				// The metadata store owns the "what type / which operators / is it a picklist" join; this
				// row only reads the resolved answers for its chosen field and renders them.
				const fieldPicklist = row.field ? resolver.isPicklist(row.field) : false;
				const fieldType = row.field ? resolver.getFieldType(row.field) : undefined;
				const operators = row.field ? resolver.getOperatorsFor(row.field) : [];
				const operatorOptions: VtSelectOption[] = operators.map((operator) => ({
					value: operator,
					label: operator,
				}));
				const selectedOperator =
					operatorOptions.find((option) => option.value === row.operator) ?? null;
				const values = row.field ? resolver.getPicklistValues(row.field) : undefined;
				return (
					<div key={row.id} className="vt-filter-row-wrap">
						<div className="vt-filter-row">
							<div className="vt-filter-row-controls">
								<div className="vt-filter-field">
									<FilterFieldCombobox
										fields={fields}
										value={row.field}
										inputId={`vt-filter-field-${row.id}`}
										onSelect={(name) =>
											onRowChange(row.id, {
												field: name,
												operator: undefined,
												value: '',
												values: [],
											})
										}
									/>
								</div>
								<div className="vt-filter-op">
									<VtSelect
										aria-label="Filter operator"
										placeholder="op"
										isDisabled={!row.field}
										options={operatorOptions}
										value={selectedOperator}
										onChange={(option) =>
											onRowChange(row.id, {
												operator: (option?.value ?? undefined) as FilterOperator | undefined,
											})
										}
									/>
								</div>
							</div>
							{row.operator && (
								<FilterValueEditor
									fieldType={fieldType}
									operator={row.operator}
									value={row.value}
									values={row.values}
									isPicklist={fieldPicklist}
									picklistValues={values}
									onValueChange={(value) => onRowChange(row.id, { value })}
									onValuesChange={(values) => onRowChange(row.id, { values })}
								/>
							)}
						</div>
						<button
							type="button"
							className="vt-filter-row-remove"
							aria-label="Remove filter"
							onClick={() => onRemoveRow(row.id)}
						>
							×
						</button>
					</div>
				);
			})}
			<div className="vt-filter-actions">
				<button type="button" className="vt-btn secondary vt-filter-add" onClick={onAddRow}>
					+ Add filter
				</button>
				{previousResultsFilter && (
					<button
						type="button"
						className="vt-btn secondary vt-filter-prev"
						onClick={previousResultsFilter.onApply}
					>
						{previousResultsFilter.label}
					</button>
				)}
			</div>
		</div>
	);
}
