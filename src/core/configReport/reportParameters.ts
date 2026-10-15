/**
 * Pure parameter model for the Vault Configuration Report and its encoding to the form body Vault's
 * `configreport` endpoint expects. Kept vscode-free and transport-free so the mapping — including
 * which optional fields are omitted — is unit-testable in isolation; the VaultClient and the webview
 * form both build on this shape.
 */

/** The output workbook format: `Excel` (XLSX) or `Excel_Macro_Enabled` (XLSM). */
export type ConfigReportFormat = 'Excel' | 'Excel_Macro_Enabled';

/**
 * Earliest selectable day for the "modified since" cutoff — Vault's own launch, since no component
 * could have been modified before it. Bounds the webview form's date popover; the API itself imposes
 * no lower limit.
 */
export const CONFIG_REPORT_EARLIEST_MODIFIED_SINCE = '2011-01-01';

/**
 * The user-chosen scope of a Configuration Report, mirroring Vault's `configreport` body parameters in
 * editor-friendly (typed, camelCase) form. The two optional scoping fields left empty mean "all".
 */
export interface ConfigReportParameters {
	includeVaultSettings: boolean;
	includeInactiveComponents: boolean;
	includeDocBinderTemplates: boolean;
	suppressEmptyResults: boolean;
	/** `yyyy-mm-dd`; empty/undefined includes all components regardless of their modified date. */
	modifiedSince?: string;
	/** Component type names to restrict the report to; empty includes all types. */
	componentTypes?: string[];
	outputFormat: ConfigReportFormat;
}

/**
 * The report parameters matching Vault's own defaults — the tracer-bullet run submits exactly these,
 * and the webview form opens pre-set to them.
 */
export const DEFAULT_CONFIG_REPORT_PARAMETERS: ConfigReportParameters = {
	includeVaultSettings: true,
	includeInactiveComponents: false,
	includeDocBinderTemplates: true,
	suppressEmptyResults: false,
	outputFormat: 'Excel_Macro_Enabled',
};

/**
 * Encode report parameters as the `application/x-www-form-urlencoded` fields Vault's `configreport`
 * endpoint expects. The four booleans and the format are always sent; `include_components_modified_since`
 * and `component_types` are omitted when empty so Vault applies its "all" default rather than receiving
 * a blank value.
 */
export function encodeConfigReportBody(params: ConfigReportParameters): Record<string, string> {
	const body: Record<string, string> = {
		include_vault_settings: String(params.includeVaultSettings),
		include_inactive_components: String(params.includeInactiveComponents),
		include_doc_binder_templates: String(params.includeDocBinderTemplates),
		suppress_empty_results: String(params.suppressEmptyResults),
		output_format: params.outputFormat,
	};
	const modifiedSince = params.modifiedSince?.trim();
	if (modifiedSince) {
		body.include_components_modified_since = modifiedSince;
	}
	const componentTypes = (params.componentTypes ?? [])
		.map((type) => type.trim())
		.filter((type) => type.length > 0);
	if (componentTypes.length > 0) {
		body.component_types = componentTypes.join(',');
	}
	return body;
}
