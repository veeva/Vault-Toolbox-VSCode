import { describe, it, expect } from 'vitest';
import {
	DEFAULT_CONFIG_REPORT_PARAMETERS,
	encodeConfigReportBody,
	type ConfigReportParameters,
} from './reportParameters';

describe('encodeConfigReportBody', () => {
	it('always sends the four booleans and the output format, omitting empty optionals by default', () => {
		const body = encodeConfigReportBody(DEFAULT_CONFIG_REPORT_PARAMETERS);

		expect(body).toEqual({
			include_vault_settings: 'true',
			include_inactive_components: 'false',
			include_doc_binder_templates: 'true',
			suppress_empty_results: 'false',
			output_format: 'Excel_Macro_Enabled',
		});
		expect(body).not.toHaveProperty('include_components_modified_since');
		expect(body).not.toHaveProperty('component_types');
	});

	it('reflects toggled booleans and a chosen plain-Excel format', () => {
		const params: ConfigReportParameters = {
			includeVaultSettings: false,
			includeInactiveComponents: true,
			includeDocBinderTemplates: false,
			suppressEmptyResults: true,
			outputFormat: 'Excel',
		};

		expect(encodeConfigReportBody(params)).toEqual({
			include_vault_settings: 'false',
			include_inactive_components: 'true',
			include_doc_binder_templates: 'false',
			suppress_empty_results: 'true',
			output_format: 'Excel',
		});
	});

	it('includes a trimmed modified-since date when provided', () => {
		const body = encodeConfigReportBody({
			...DEFAULT_CONFIG_REPORT_PARAMETERS,
			modifiedSince: ' 2026-01-15 ',
		});

		expect(body.include_components_modified_since).toBe('2026-01-15');
	});

	it('joins component types with commas, dropping blank entries', () => {
		const body = encodeConfigReportBody({
			...DEFAULT_CONFIG_REPORT_PARAMETERS,
			componentTypes: [' Doclifecycle ', '', 'Workflow', '   '],
		});

		expect(body.component_types).toBe('Doclifecycle,Workflow');
	});

	it('omits component_types when the list has only blank entries', () => {
		const body = encodeConfigReportBody({
			...DEFAULT_CONFIG_REPORT_PARAMETERS,
			componentTypes: ['', '  '],
		});

		expect(body).not.toHaveProperty('component_types');
	});
});
