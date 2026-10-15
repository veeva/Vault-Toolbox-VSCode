import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from './Pagination';
import type { QueryResponseDetails } from '../../core/rest/types';

/**
 * The pager gates strictly on page-token presence AND the `running` flag. These tests pin the
 * enable/disable matrix — the bug class where a stale token leaves a button clickable mid-request,
 * or an absent token (workflows/users targets return none) is treated as "assume a page exists".
 */
describe('Pagination', () => {
	const both: QueryResponseDetails = {
		pageoffset: 200,
		size: 200,
		total: 4213,
		previousPage: '/query/prev-token',
		nextPage: '/query/next-token',
	};

	it('enables Prev and Next when both tokens are present and not running', () => {
		render(<Pagination details={both} running={false} onPage={vi.fn()} />);
		expect(screen.getByRole('button', { name: /Prev/ })).toBeEnabled();
		expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
	});

	it('disables both buttons while running even when tokens are present', () => {
		render(<Pagination details={both} running={true} onPage={vi.fn()} />);
		expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
		expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
	});

	it('disables Prev on the first page (no previous token) and Next on the last page (no next token)', () => {
		const firstPage: QueryResponseDetails = { pageoffset: 0, size: 200, total: 4213, nextPage: '/query/next-token' };
		const { unmount } = render(<Pagination details={firstPage} running={false} onPage={vi.fn()} />);
		expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
		expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
		unmount();

		const lastPage: QueryResponseDetails = { pageoffset: 4200, size: 13, total: 4213, previousPage: '/query/prev-token' };
		render(<Pagination details={lastPage} running={false} onPage={vi.fn()} />);
		expect(screen.getByRole('button', { name: /Prev/ })).toBeEnabled();
		expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
	});

	it('invokes onPage with the token when an enabled button is clicked', async () => {
		const onPage = vi.fn();
		render(<Pagination details={both} running={false} onPage={onPage} />);
		await userEvent.click(screen.getByRole('button', { name: /Next/ }));
		expect(onPage).toHaveBeenCalledWith('/query/next-token');
	});
});
