import type { QueryDescribe, QueryResult, QueryRow } from '../../core/rest/types';
import {
	deriveGridColumns,
	expandedCells,
	subqueryRowSpan,
	type GridColumn,
} from '../../core/vql/resultGrid';

/**
 * Plain HTML `<table>` grid styled with VS Code theme vars. Columns are the first row's
 * keys in Vault order, subquery-aware via `describe` (`deriveGridColumns`). A record with
 * subquery data renders as one row-spanned `<tr>` group — normal fields rowSpan across it, subquery
 * fields get one `<td>` per stacked record. An empty result set shows a hint (known limitation:
 * no rows → no columns).
 */
export function ResultGrid({
	result,
	describe,
}: {
	result: QueryResult;
	/**
	 * The describe to derive columns from. Vault only returns `queryDescribe` on a query's first page,
	 * so callers paginating through the same query must pass down that first page's describe on every
	 * subsequent page — otherwise a later page whose subquery rows happen to be empty loses that
	 * subquery's field list entirely (see `deriveGridColumns`). Defaults to `result.queryDescribe` for
	 * callers that never paginate.
	 */
	describe?: QueryDescribe;
}): JSX.Element {
	const columns = deriveGridColumns(result.data, describe ?? result.queryDescribe);
	if (columns.length === 0) {
		return <p className="vt-hint">No results to display</p>;
	}
	const hasSubqueries = columns.some((column) => column.subFields);
	return (
		<div className="vt-grid-wrap">
			<table className="vt-grid">
				<thead>
					<tr>
						{columns.map((column) =>
							column.subFields ? (
								<th key={column.key} colSpan={column.subFields.length}>
									{column.key}
								</th>
							) : (
								<th key={column.key} rowSpan={hasSubqueries ? 2 : 1}>
									{column.key}
								</th>
							),
						)}
					</tr>
					{hasSubqueries && (
						<tr>
							{columns.flatMap((column) =>
								(column.subFields ?? []).map((field) => (
									<th key={`${column.key}.${field}`}>{field}</th>
								)),
							)}
						</tr>
					)}
				</thead>
				<tbody>
					{result.data.map((row, index) => (
						<RecordRows
							key={typeof row.id === 'string' ? row.id : index}
							row={row}
							columns={columns}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The one or more stacked `<tr>`s a single record expands into (see `subqueryRowSpan`). */
function RecordRows({ row, columns }: { row: QueryRow; columns: GridColumn[] }): JSX.Element {
	const span = subqueryRowSpan(row);
	const rows: JSX.Element[] = [];
	for (let stackedRowIndex = 0; stackedRowIndex < span; stackedRowIndex++) {
		rows.push(
			<tr key={stackedRowIndex}>
				{columns.flatMap((column) => {
					const cells = expandedCells(row[column.key], column.subFields, stackedRowIndex);
					if (!column.subFields) {
						// Normal field: rowSpan covers the remaining stacked rows, so emit it only once.
						return stackedRowIndex === 0
							? [
									<td key={column.key} rowSpan={span}>
										{cells[0]}
									</td>,
								]
							: [];
					}
					return cells.map((text, fieldIndex) => (
						<td key={`${column.key}.${fieldIndex}`}>{text}</td>
					));
				})}
			</tr>,
		);
	}
	return <>{rows}</>;
}
