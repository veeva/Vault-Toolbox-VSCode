import type { ConfigReportParameters } from '../../core/configReport/reportParameters';
import { VtSelect, type VtSelectOption } from '../editor/builder/VtSelect';
import { Spinner } from '../editor/Spinner';
import { InfoIcon, ResetDefaultsIcon, SaveIcon } from '../shell/icons';
import { DatePopoverField } from './DatePopoverField';

/** Per-field help text, condensed from the `configreport` endpoint's parameter descriptions. */
const FIELD_HELP = {
	modifiedSince: 'Only include components modified since this date. Empty includes all.',
	componentTypes:
		'List of component types to include (e.g. Doclifecycle, Doctype, Workflow). Empty includes all components and adds an Excel object data report to the ZIP output.',
} as const;

/** A circled-"i" affordance whose hover/focus tooltip carries a field's condensed help text. */
function InfoHint({ text }: { text: string }): JSX.Element {
	return (
		<span
			className="vt-info-hint"
			data-tooltip={text}
			data-tooltip-dir="below"
			data-tooltip-wrap=""
			tabIndex={0}
			role="note"
			aria-label={text}
		>
			<InfoIcon />
		</span>
	);
}

interface ConfigReportFormProps {
	params: ConfigReportParameters;
	/** Inclusive earliest selectable "modified since" day (`yyyy-mm-dd`); earlier days render disabled. */
	earliest: string;
	/** Inclusive latest selectable "modified since" day (`yyyy-mm-dd`, today UTC); later days render disabled. */
	latest: string;
	/** True while the host submits, polls, downloads, and extracts; disables controls and shows a spinner. */
	isLoading?: boolean;
	/** Inline error message from the host when the download fails. */
	error?: string;
	/** Component type names fetched from the connected Vault; empty while loading or when not connected. */
	componentTypes: string[];
	/** True while the host is fetching component types; shows a spinner inside the dropdown. */
	isLoadingTypes?: boolean;
	/** Workspace-relative folder the report will be written to; undefined hides the preview. */
	location?: string;
	/** True when params differ from the baseline loaded at open; enables the "Save as defaults" button. */
	isDirty?: boolean;
	/** True when params differ from the hardcoded API defaults; enables the "Reset to defaults" button. */
	canReset?: boolean;
	/** True briefly after saving; changes the "Save as defaults" button's tooltip to "Saved!". */
	isSaved?: boolean;
	onParamsChange(params: ConfigReportParameters): void;
	onDownload(): void;
	onChangeLocation(): void;
	onSaveSettings(): void;
	onResetDefaults(): void;
	onBack(): void;
}

/** The two output-format choices, most-common (macro-enabled) first to match Vault's own default. */
const FORMAT_OPTIONS: VtSelectOption[] = [
	{ value: 'Excel_Macro_Enabled', label: 'Excel Macro-Enabled (XLSM)' },
	{ value: 'Excel', label: 'Excel (XLSX)' },
];

/** One labelled boolean toggle rendered as a native checkbox pre-set to its API default. */
interface CheckboxFieldProps {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange(checked: boolean): void;
}

function CheckboxField({ label, checked, disabled, onChange }: CheckboxFieldProps): JSX.Element {
	return (
		<label className="vt-checkbox-field">
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span>{label}</span>
		</label>
	);
}

/**
 * The Download Vault Configuration Report form: the report's optional parameters as native checkboxes,
 * a date popover (the same calendar grid the Developer Log forms use, in single-select mode — see
 * {@link DatePopoverField}), a creatable multi-select of component types, and an output-format select,
 * plus a preview of the {@link location} the report will be written to and a "Change Location" link to
 * its setting. Modelled on {@link CompareSelector}'s screen-swap pattern — parameter state is owned by
 * the parent so it survives leaving and re-entering the screen. The header carries two icon buttons:
 * "Save as defaults" ({@link isDirty}-gated) and "Reset to defaults" ({@link canReset}-gated, discards
 * back to the hardcoded API defaults).
 *
 * The Download button is always enabled (every parameter is optional). While the host is working
 * ({@link isLoading}), controls are disabled and a spinner is shown; a host failure surfaces in
 * {@link error} inline so the user can adjust and retry without leaving the screen.
 */
export function ConfigReportForm({
	params,
	earliest,
	latest,
	isLoading = false,
	error,
	location,
	componentTypes,
	isLoadingTypes = false,
	isDirty = false,
	canReset = false,
	isSaved = false,
	onParamsChange,
	onDownload,
	onChangeLocation,
	onSaveSettings,
	onResetDefaults,
	onBack,
}: ConfigReportFormProps): JSX.Element {
	const patch = (fields: Partial<ConfigReportParameters>): void =>
		onParamsChange({ ...params, ...fields });

	const componentTypeValue = (params.componentTypes ?? []).map((type) => ({ value: type, label: type }));
	const selectedFormat = FORMAT_OPTIONS.find((option) => option.value === params.outputFormat) ?? null;

	return (
		<div className="vt-config-report-form">
			<div className="vt-config-report-header-row">
				<h2 className="vt-developer-logs-header">Download Vault Configuration Report</h2>
				<div className="vt-config-report-header-actions">
					<button
						type="button"
						className="vt-header-action-btn"
						disabled={isLoading || !isDirty}
						onClick={onSaveSettings}
						data-tooltip={isSaved ? 'Saved!' : 'Save as defaults'}
						data-tooltip-dir="below"
						aria-label="Save as defaults"
					>
						<SaveIcon />
					</button>
					<button
						type="button"
						className="vt-header-action-btn"
						disabled={isLoading || !canReset}
						onClick={onResetDefaults}
						data-tooltip="Reset to defaults"
						data-tooltip-dir="below"
						aria-label="Reset to defaults"
					>
						<ResetDefaultsIcon />
					</button>
				</div>
			</div>

			<div className="vt-checkbox-group">
				<CheckboxField
					label="Include Vault Settings"
					checked={params.includeVaultSettings}
					disabled={isLoading}
					onChange={(checked) => patch({ includeVaultSettings: checked })}
				/>
				<CheckboxField
					label="Include inactive components"
					checked={params.includeInactiveComponents}
					disabled={isLoading}
					onChange={(checked) => patch({ includeInactiveComponents: checked })}
				/>
				<CheckboxField
					label="Include document & binder templates"
					checked={params.includeDocBinderTemplates}
					disabled={isLoading}
					onChange={(checked) => patch({ includeDocBinderTemplates: checked })}
				/>
				<CheckboxField
					label="Suppress empty results"
					checked={params.suppressEmptyResults}
					disabled={isLoading}
					onChange={(checked) => patch({ suppressEmptyResults: checked })}
				/>
			</div>

			<div className="vt-form-field">
				<div className="vt-field-label-row">
					<label htmlFor="vt-config-report-since">Components modified since</label>
					<InfoHint text={FIELD_HELP.modifiedSince} />
				</div>
				<DatePopoverField
					id="vt-config-report-since"
					aria-label="Components modified since"
					selected={params.modifiedSince}
					earliest={earliest}
					latest={latest}
					placeholder="All dates"
					isDisabled={isLoading}
					onSelect={(day) => patch({ modifiedSince: day })}
				/>
			</div>

			<div className="vt-form-field">
				<div className="vt-field-label-row">
					<label htmlFor="vt-config-report-types">Component types</label>
					<InfoHint text={FIELD_HELP.componentTypes} />
				</div>
				<VtSelect<true>
					inputId="vt-config-report-types"
					aria-label="Component types"
					isMulti
					isCreatable
					isDisabled={isLoading}
					isLoading={isLoadingTypes}
					placeholder="Add a component type…"
					formatCreateLabel={(input) => `Add "${input}"`}
					options={componentTypes.map((type) => ({ value: type, label: type }))}
					value={componentTypeValue}
					onChange={(options) =>
						patch({ componentTypes: options.map((option) => option.value) })
					}
				/>
			</div>

			<div className="vt-form-field">
				<label htmlFor="vt-config-report-format">Output format</label>
				<VtSelect
					inputId="vt-config-report-format"
					aria-label="Output format"
					isDisabled={isLoading}
					options={FORMAT_OPTIONS}
					value={selectedFormat}
					onChange={(option) =>
						patch({ outputFormat: option?.value === 'Excel' ? 'Excel' : 'Excel_Macro_Enabled' })
					}
				/>
			</div>

			<div className="vt-config-report-location">
				{location ? (
					<span className="vt-hint">
						Files will be written to: <code>{location}</code>
					</span>
				) : (
					<span className="vt-hint">Connect a Vault to see where the report will be saved.</span>
				)}
				<button
					type="button"
					className="vt-link-button vt-config-report-location-btn"
					disabled={isLoading}
					onClick={onChangeLocation}
				>
					Change Location
				</button>
			</div>

			{error && (
				<div className="vt-error" role="alert">
					{error}
				</div>
			)}

			<div className="vt-toolbar">
				{isLoading ? (
					<Spinner label="Downloading Configuration Report…" />
				) : (
					<button type="button" className="vt-btn" onClick={onDownload}>
						Download Report
					</button>
				)}
				<button type="button" className="vt-btn secondary" disabled={isLoading} onClick={onBack}>
					Back
				</button>
			</div>
		</div>
	);
}
