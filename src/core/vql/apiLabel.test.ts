import { describe, it, expect } from 'vitest';
import { displayLabel } from './apiLabel';

describe('displayLabel', () => {
	it('leaves a real human label untouched', () => {
		expect(displayLabel('access_request__c', 'Access Request')).toBe('Access Request');
	});

	it('humanizes a label that echoes the name, stripping the __suffix', () => {
		expect(displayLabel('active_workflow__sys', 'active_workflow__sys')).toBe('Active Workflow');
	});

	it('humanizes a name without a __suffix', () => {
		expect(displayLabel('documents', 'documents')).toBe('Documents');
	});

	it('drops empty segments left by an internal double underscore', () => {
		expect(displayLabel('foo__bar__c', 'foo__bar__c')).toBe('Foo Bar');
	});

	it('leaves already-capitalized letters within a word untouched', () => {
		expect(displayLabel('my_ABC_thing__c', 'my_ABC_thing__c')).toBe('My ABC Thing');
	});

	it('returns undefined when there is no label', () => {
		expect(displayLabel('active_workflow__sys', undefined)).toBeUndefined();
	});

	it('falls back to the original label when humanizing yields nothing', () => {
		expect(displayLabel('__c', '__c')).toBe('__c');
	});
});
