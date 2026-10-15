import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ResultGrid } from './ResultGrid';
import type { QueryResult } from '../../core/rest/types';

/**
 * jsdom render tests for the grid. The subquery row-span path is the known render-crash class (a
 * record expanding into N stacked `<tr>`s with normal fields rowSpanned across them), so it gets a
 * realistic Vault payload; the empty path guards the "no rows → no columns" hint branch.
 */
describe('ResultGrid', () => {
	it('renders a subquery result with the correct row-span structure', () => {
		// One parent document with a 2-record child subquery ("renditions__vr"), plus a scalar
		// (name__v) and a null field (description__v) backfilled from queryDescribe.
		const result: QueryResult = {
			data: [
				{
					id: 'doc-1',
					name__v: 'Protocol A',
					renditions__vr: {
						data: [
							{ rendition_type__v: 'viewable_rendition__v' },
							{ rendition_type__v: 'source__v' },
						],
					},
				},
			],
			responseDetails: { pagesize: 200, pageoffset: 0, size: 1, total: 1 },
			queryDescribe: {
				object: { name: 'documents' },
				fields: [
					{ name: 'id', type: 'id' },
					{ name: 'name__v', type: 'String' },
					{ name: 'description__v', type: 'String' },
				],
				subqueries: [
					{
						relationship: 'renditions__vr',
						fields: [{ name: 'rendition_type__v', type: 'String' }],
					},
				],
			},
			raw: {},
		};

		render(<ResultGrid result={result} />);

		// Subquery header nests under its relationship name.
		expect(screen.getByRole('columnheader', { name: 'renditions__vr' })).toBeInTheDocument();
		expect(screen.getByRole('columnheader', { name: 'rendition_type__v' })).toBeInTheDocument();

		// The record expands into 2 stacked body rows (largest subquery length).
		const bodyRows = screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
		expect(bodyRows).toHaveLength(2);

		// The scalar field is emitted once, row-spanning both stacked rows.
		const nameCell = screen.getByRole('cell', { name: 'Protocol A' });
		expect(nameCell).toHaveAttribute('rowspan', '2');

		// Both subquery records render their own cell.
		expect(screen.getByRole('cell', { name: 'viewable_rendition__v' })).toBeInTheDocument();
		expect(screen.getByRole('cell', { name: 'source__v' })).toBeInTheDocument();
	});

	it('keeps the subquery column on a paginated page whose describe was dropped and whose own subquery is empty (regression)', () => {
		// Reproduces a reported bug: `SELECT id, name__v, (SELECT id, name__v FROM rl_children__cr)
		// FROM rl_parent__c PAGESIZE 1`. Page 1 returns queryDescribe plus a parent with 2 children;
		// page 2 (Vault never resends queryDescribe on paginated responses) returns a parent with 0
		// children, so page 2's own row gives no hint that rl_children__cr should be a column. The fix
		// is the caller (VqlEditor) retaining page 1's describe and passing it down on every later page —
		// this test exercises that contract at the ResultGrid boundary by passing the retained describe
		// explicitly alongside page 2's result.
		const describeFromPage1: QueryResult['queryDescribe'] = {
			object: { name: 'rl_parent__c' },
			fields: [{ name: 'id', type: 'id' }, { name: 'name__v', type: 'String' }],
			subqueries: [
				{
					relationship: 'rl_children__cr',
					fields: [{ name: 'id', type: 'id' }, { name: 'name__v', type: 'String' }],
				},
			],
		};
		const page2: QueryResult = {
			data: [
				{
					id: 'V5200000000Q001',
					name__v: 'Parent 2',
					rl_children__cr: {
						data: [],
						responseDetails: { pagesize: 250, pageoffset: 0, size: 0, total: 0 },
					},
				},
			],
			responseDetails: { pagesize: 1, pageoffset: 1, size: 1, total: 2 },
			// Page 2's own response carries no queryDescribe, per Vault's contract.
			raw: {},
		};

		render(<ResultGrid result={page2} describe={describeFromPage1} />);

		// The subquery column survives — both its own header and its nested field sub-headers — even
		// though page 2's row has zero children and no describe of its own.
		expect(screen.getByRole('columnheader', { name: 'rl_children__cr' })).toBeInTheDocument();
		expect(screen.getAllByRole('columnheader', { name: 'id' })).toHaveLength(2);
		expect(screen.getAllByRole('columnheader', { name: 'name__v' })).toHaveLength(2);

		// Page 2's parent row still renders, with blank cells for the empty subquery.
		expect(screen.getByRole('cell', { name: 'Parent 2' })).toBeInTheDocument();
		expect(screen.getAllByRole('cell', { name: '' })).toHaveLength(2);
	});

	it('loses the subquery field list when no describe is available at all (documents the pre-fix failure mode)', () => {
		// Same page-2 payload as above, but rendered the way the pre-fix code path did: no retained
		// describe reaches the grid at all (falls back to page 2's own `queryDescribe`, which is
		// undefined). `rl_children__cr` has no data to sniff (empty array) and no describe to consult,
		// so `deriveGridColumns` can't recover its field list — this is the bug the fix above prevents.
		const page2: QueryResult = {
			data: [
				{
					id: 'V5200000000Q001',
					name__v: 'Parent 2',
					rl_children__cr: {
						data: [],
						responseDetails: { pagesize: 250, pageoffset: 0, size: 0, total: 0 },
					},
				},
			],
			responseDetails: { pagesize: 1, pageoffset: 1, size: 1, total: 2 },
			raw: {},
		};

		render(<ResultGrid result={page2} />);

		// The column itself still appears (its key is present on the row), but its nested field
		// sub-headers are gone — unlike the fixed case above, `id`/`name__v` now appear only once
		// each (the top-level columns), not twice (top-level + subquery sub-header).
		expect(screen.getByRole('columnheader', { name: 'rl_children__cr' })).toBeInTheDocument();
		expect(screen.getAllByRole('columnheader', { name: 'id' })).toHaveLength(1);
		expect(screen.getAllByRole('columnheader', { name: 'name__v' })).toHaveLength(1);
	});

	it('shows the empty-state hint when the result has no rows', () => {
		const result: QueryResult = {
			data: [],
			responseDetails: { size: 0, total: 0 },
			raw: {},
		};

		render(<ResultGrid result={result} />);

		expect(screen.getByText('No results to display')).toBeInTheDocument();
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
	});
});
