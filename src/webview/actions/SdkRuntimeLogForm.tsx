import { DEFAULT_SDK_RUNTIME_LOG_FORMAT, type SdkRuntimeLogFormat } from '../../core/developerLogs/sdkRuntimeLog';
import { Spinner } from '../editor/Spinner';
import { VtSelect, type VtSelectOption } from '../editor/builder/VtSelect';
import { DateMultiSelect } from './DateCalendar';
import { dayCountLabel } from './dayCountLabel';

interface SdkRuntimeLogFormProps {
	/** The chosen UTC calendar days (`yyyy-mm-dd`) to download logs for; one file is written per date. */
	dates: string[];
	/** Inclusive earliest selectable day (`yyyy-mm-dd`); older days are past Vault's retention window. */
	earliest: string;
	/** Inclusive latest selectable day (`yyyy-mm-dd`), i.e. today (UTC). */
	latest: string;
	/** The chosen download file format, sent to Vault as `log_format`. */
	logFormat: SdkRuntimeLogFormat;
	/** True while the host downloads and extracts; disables controls and shows a spinner. */
	isLoading?: boolean;
	/** Why the current selection can't be submitted, shown inline; absent when it is valid. */
	dateError?: string;
	/** Inline error message from the host when the download fails. */
	error?: string;
	/** Workspace-relative folder the logs will be written to; undefined hides the preview. */
	location?: string;
	/** Whether the selection currently passes validation; the Download button is disabled when false. */
	canDownload: boolean;
	onToggleDate(date: string): void;
	onFormatChange(format: SdkRuntimeLogFormat): void;
	onChangeLocation(): void;
	onDownload(): void;
	onBack(): void;
}

/** The two download-format choices, CSV first to match {@link DEFAULT_SDK_RUNTIME_LOG_FORMAT}. */
const FORMAT_OPTIONS: VtSelectOption[] = [
	{ value: 'csv', label: 'CSV' },
	{ value: 'logfile', label: 'Log file' },
];

/**
 * The Download SDK Runtime Log form: a calendar to pick one or more UTC days, a format control, and a
 * Download button. A bespoke mirror of {@link ApiUsageLogForm} (see ADR 0008) — the selected dates and
 * format live in the parent so they survive leaving and re-entering the screen. A preview of the
 * {@link location} the logs will be written to and a "Change Location" link to its setting mirror the API
 * Usage Log form.
 *
 * The selection is validated by the parent against UTC now; an empty or out-of-range selection disables
 * Download ({@link canDownload}) and surfaces {@link dateError} inline. While the host is working
 * ({@link isLoading}), controls are disabled and a spinner is shown; a host failure surfaces in
 * {@link error} inline so the user can adjust and retry without leaving the screen.
 */
export function SdkRuntimeLogForm({
	dates,
	earliest,
	latest,
	logFormat,
	isLoading = false,
	dateError,
	error,
	location,
	canDownload,
	onToggleDate,
	onFormatChange,
	onChangeLocation,
	onDownload,
	onBack,
}: SdkRuntimeLogFormProps): JSX.Element {
	// The host's location is the format-agnostic base folder; each download nests a log under a `<date>`
	// subfolder (see sdkRuntimeLogRunSegments). Show the exact folder for a single date, a placeholder for many.
	const soleDate = dates.length === 1 ? dates[0] : undefined;
	const destination = location ? `${location}/${soleDate ?? '<date>'}` : undefined;
	return (
		<div className="vt-sdk-runtime-log-form">
			<h2 className="vt-developer-logs-header">Download SDK Runtime Log</h2>

			<div className="vt-form-field">
				<label id="vt-sdk-runtime-log-dates-label">Dates (UTC)</label>
				<DateMultiSelect
					selected={dates}
					earliest={earliest}
					latest={latest}
					isDisabled={isLoading}
					onToggle={onToggleDate}
				/>
				<div className="vt-hint">
					{dates.length === 0
						? 'Select one or more days to download.'
						: `${dayCountLabel(dates.length)} selected.`}
				</div>
				{dateError && (
					<div className="vt-field-error" role="alert">
						{dateError}
					</div>
				)}
			</div>

			<div className="vt-form-field">
				<label htmlFor="vt-sdk-runtime-log-format">Format</label>
				<VtSelect
					inputId="vt-sdk-runtime-log-format"
					aria-label="Format"
					isDisabled={isLoading}
					options={FORMAT_OPTIONS}
					value={FORMAT_OPTIONS.find((option) => option.value === logFormat) ?? null}
					onChange={(option) =>
						onFormatChange((option?.value as SdkRuntimeLogFormat) ?? DEFAULT_SDK_RUNTIME_LOG_FORMAT)
					}
				/>
			</div>

			<div className="vt-developer-logs-location">
				{destination ? (
					<span className="vt-hint">
						Files will be written to: <code>{destination}</code>
					</span>
				) : (
					<span className="vt-hint">Connect a Vault to see where the logs will be saved.</span>
				)}
				<button
					type="button"
					className="vt-link-button vt-developer-logs-location-btn"
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
					<Spinner label="Downloading SDK Runtime Log…" />
				) : (
					<button
						type="button"
						className="vt-btn"
						disabled={!canDownload}
						onClick={onDownload}
					>
						Download
					</button>
				)}
				<button type="button" className="vt-btn secondary" disabled={isLoading} onClick={onBack}>
					Back
				</button>
			</div>
		</div>
	);
}
