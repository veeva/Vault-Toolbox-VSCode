import { describe, it, expect } from 'vitest';
import type { VaultPicklistSummary } from '../rest/types';
import {
	buildPicklistFieldIndex,
	picklistFieldsForContainer,
	picklistNameForField,
} from './picklistIndex';

const picklists: VaultPicklistSummary[] = [
	{
		name: 'issue_source__v',
		label: 'Source',
		usedIn: [{ objectName: 'issue_escalation__v', propertyName: 'issue_source__v' }],
	},
	{
		// A field whose property name differs from the picklist name — the reverse-map must key on the
		// property, not assume the picklist name is the field name.
		name: 'exception_item_error_status__sys',
		label: 'Error Status',
		usedIn: [{ objectName: 'exception_item__sys', propertyName: 'error_status__sys' }],
	},
	{
		name: 'email_template_type__v',
		label: 'Email Template Type',
		usedIn: [{ documentTypeName: 'email_template__v', propertyName: 'emailTemplateType_b' }],
	},
];

describe('buildPicklistFieldIndex', () => {
	it('reverse-maps object usedIn entries by (object, field) → picklist name', () => {
		const index = buildPicklistFieldIndex(picklists);
		expect(picklistNameForField(index, 'issue_escalation__v', 'issue_source__v')).toBe(
			'issue_source__v',
		);
		expect(picklistNameForField(index, 'exception_item__sys', 'error_status__sys')).toBe(
			'exception_item_error_status__sys',
		);
	});

	it('reverse-maps document usedIn entries under the document type name', () => {
		const index = buildPicklistFieldIndex(picklists);
		expect(picklistNameForField(index, 'email_template__v', 'emailTemplateType_b')).toBe(
			'email_template_type__v',
		);
	});

	it('does not cross-map a field to another object that lacks it', () => {
		const index = buildPicklistFieldIndex(picklists);
		expect(picklistNameForField(index, 'exception_item__sys', 'issue_source__v')).toBeUndefined();
		expect(picklistNameForField(index, 'unknown__v', 'issue_source__v')).toBeUndefined();
	});

	it('skips usedIn entries missing a container or a property name', () => {
		const index = buildPicklistFieldIndex([
			{ name: 'license_type__v', usedIn: [] },
			{ name: 'orphan__v', usedIn: [{ propertyName: 'no_container__v' }] },
			{ name: 'no_property__v', usedIn: [{ objectName: 'thing__v' }] },
		]);
		expect(index.size).toBe(0);
	});
});

describe('picklistFieldsForContainer', () => {
	it('projects a container to its field → picklist name record', () => {
		const index = buildPicklistFieldIndex([
			{ name: 'a__v', usedIn: [{ objectName: 'product__v', propertyName: 'color__v' }] },
			{ name: 'b__v', usedIn: [{ objectName: 'product__v', propertyName: 'size__v' }] },
			{ name: 'c__v', usedIn: [{ objectName: 'other__v', propertyName: 'kind__v' }] },
		]);
		expect(picklistFieldsForContainer(index, 'product__v')).toEqual({
			color__v: 'a__v',
			size__v: 'b__v',
		});
	});

	it('returns an empty record for a container with no picklist fields', () => {
		const index = buildPicklistFieldIndex(picklists);
		expect(picklistFieldsForContainer(index, 'no_picklists__v')).toEqual({});
	});
});
