import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterValueEditor } from './FilterValueEditor';

/**
 * A DateTime filter must produce a value VQL accepts: a single-quoted `YYYY-MM-DDTHH:MM:SS.000Z`
 * literal. A native `datetime-local` picker can only emit `YYYY-MM-DDTHH:MM` (no seconds, no `.000Z`),
 * which is invalid even once quoted — the reported defect. So the DateTime widget is a plain text
 * input carrying a format hint, letting the user type the full literal. This pins that shape.
 */
describe('FilterValueEditor DateTime widget', () => {
	it('renders a text input (not a datetime picker) with a UTC format-hint placeholder', () => {
		render(
			<FilterValueEditor
				fieldType="DateTime"
				operator="<"
				value=""
				values={[]}
				onValueChange={vi.fn()}
				onValuesChange={vi.fn()}
			/>,
		);

		const input = screen.getByLabelText('Filter value');
		expect(input).toHaveAttribute('type', 'text');
		expect(input).toHaveAttribute('placeholder', expect.stringContaining('.000Z'));
	});
});
