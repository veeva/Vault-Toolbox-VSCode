import { describe, expect, it } from 'vitest';
import { fieldSublabel } from './fieldLabels';

describe('fieldSublabel', () => {
	it('wraps the type in parentheses after the API name', () => {
		expect(fieldSublabel({ name: 'parent__v', type: 'String' })).toBe('parent__v (String)');
	});

	it('falls back to the bare name when the type is unknown', () => {
		expect(fieldSublabel({ name: 'parent__v' })).toBe('parent__v');
	});
});
