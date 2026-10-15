import { useCallback, useEffect, useRef, useState } from 'react';
import {
	isActiveEnvironmentConnected,
	type EnvironmentRow,
} from '../../shared/environmentsProtocol';
import {
	CONFIG_REPORT_EARLIEST_MODIFIED_SINCE,
	DEFAULT_CONFIG_REPORT_PARAMETERS,
	type ConfigReportParameters,
} from '../../core/configReport/reportParameters';
import {
	API_USAGE_LOG_MAX_AGE_DAYS,
	DEFAULT_API_USAGE_LOG_FORMAT,
	validateApiUsageLogDates,
	type ApiUsageLogFormat,
} from '../../core/developerLogs/apiUsageLog';
import { shiftUtcCalendarDay, utcCalendarDay } from '../../core/developerLogs/logDate';
import {
	DEFAULT_SDK_RUNTIME_LOG_FORMAT,
	SDK_RUNTIME_LOG_MAX_AGE_DAYS,
	validateSdkRuntimeLogDates,
	type SdkRuntimeLogFormat,
} from '../../core/developerLogs/sdkRuntimeLog';
import { onEnvironmentsSnapshot, requestEnvironments } from '../environments/environmentsClient';
import {
	cancelApiUsageLog,
	cancelConfigReport,
	cancelSdkRuntimeLog,
	onApiUsageLogLocation,
	onApiUsageLogResult,
	onComponentTypes,
	onConfigReportLocation,
	onConfigReportResult,
	onSavedConfigReportSettings,
	onSdkRuntimeLogLocation,
	onSdkRuntimeLogResult,
	openConfigReportSetting,
	openDeveloperLogsSetting,
	requestApiUsageLogLocation,
	requestComponentTypes,
	requestConfigReportLocation,
	requestSavedConfigReportSettings,
	requestSdkRuntimeLogLocation,
	runAction,
	runApiUsageLog,
	runConfigReport,
	runSdkRuntimeLog,
	saveConfigReportSettings,
} from './actionsClient';
import { buildActionsTree } from './treeModel';
import { ConfigReportForm } from './ConfigReportForm';
import { ApiUsageLogForm } from './ApiUsageLogForm';
import { SdkRuntimeLogForm } from './SdkRuntimeLogForm';
import { Tree } from './Tree';

/**
 * The action tree, the Config Report form, the API Usage Log form, or the SDK Runtime Log form.
 */
type Screen = 'tree' | 'configReport' | 'apiUsageLog' | 'sdkRuntimeLog';

/** Today's UTC calendar day as `yyyy-mm-dd`, the default both Developer Log forms open on. */
function todayUtc(): string {
	return utcCalendarDay(new Date());
}

/** Add a day to the selection if absent, or remove it if already selected. */
function toggleDay(days: string[], day: string): string[] {
	return days.includes(day) ? days.filter((selected) => selected !== day) : [...days, day];
}

/** Structural equality for Config Report params, used to derive the form's dirty/reset-eligible state. */
function paramsEqual(a: ConfigReportParameters, b: ConfigReportParameters): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The Actions tab: a tree of clickable actions plus in-panel sub-screens — the Download Configuration
 * Report form and the Download API Usage Log / SDK Runtime Log forms. Reuses the host-pushed environments
 * snapshot to gate connection-dependent leaves, requesting it on mount so the gates are correct even if
 * the Environments tab was never opened.
 *
 * Every sub-screen stays visible with a spinner while the host works; a host result message
 * ({@link onConfigReportResult} / {@link onApiUsageLogResult} / {@link onSdkRuntimeLogResult}) drives the
 * transition: success returns to the tree, an error surfaces inline without leaving the screen.
 */
export function ActionsPanel(): JSX.Element {
	const [environments, setEnvironments] = useState<EnvironmentRow[]>([]);
	const [screen, setScreen] = useState<Screen>('tree');

	// Config Report parameter state lives here (not in the form) so it survives leaving and re-opening
	// the screen, e.g. after a failed download.
	const [reportParams, setReportParams] = useState<ConfigReportParameters>(
		DEFAULT_CONFIG_REPORT_PARAMETERS,
	);
	// The params as they were when the form was first opened this session (from saved settings or
	// hardcoded defaults). Used to determine when the user has changed something worth saving.
	const [baselineParams, setBaselineParams] = useState<ConfigReportParameters>(
		DEFAULT_CONFIG_REPORT_PARAMETERS,
	);
	// True briefly after the user saves settings; drives the "Saved!" button label.
	const [isSettingsSaved, setIsSettingsSaved] = useState(false);
	// Guards against re-applying saved settings on subsequent form opens within the same session.
	const settingsInitializedRef = useRef(false);
	const [isDownloadingReport, setIsDownloadingReport] = useState(false);
	const [reportError, setReportError] = useState<string | undefined>();
	// Host-resolved preview of where a report would be written; refreshed by the host on connection or
	// setting changes and requested each time the form opens.
	const [reportLocation, setReportLocation] = useState<string | undefined>();
	// Component types fetched lazily from the Vault on first form open, cached by vault id in the host.
	const [componentTypes, setComponentTypes] = useState<string[]>([]);
	const [isLoadingTypes, setIsLoadingTypes] = useState(false);

	// API Usage Log dates live here (not in the form) so they survive leaving and re-opening the screen,
	// e.g. after a failed download. Defaults to today (UTC).
	const [apiUsageLogDates, setApiUsageLogDates] = useState<string[]>(() => [todayUtc()]);
	const [apiUsageLogFormat, setApiUsageLogFormat] = useState<ApiUsageLogFormat>(
		DEFAULT_API_USAGE_LOG_FORMAT,
	);
	const [isDownloadingApiUsageLog, setIsDownloadingApiUsageLog] = useState(false);
	const [apiUsageLogError, setApiUsageLogError] = useState<string | undefined>();
	// Host-resolved preview of where a log would be written; refreshed by the host on connection or
	// setting changes and requested each time the form opens.
	const [apiUsageLogLocation, setApiUsageLogLocation] = useState<string | undefined>();

	// SDK Runtime Log dates live here (not in the form) so they survive leaving and re-opening the screen,
	// e.g. after a failed download. Defaults to today (UTC).
	const [sdkRuntimeLogDates, setSdkRuntimeLogDates] = useState<string[]>(() => [todayUtc()]);
	const [sdkRuntimeLogFormat, setSdkRuntimeLogFormat] = useState<SdkRuntimeLogFormat>(
		DEFAULT_SDK_RUNTIME_LOG_FORMAT,
	);
	const [isDownloadingSdkRuntimeLog, setIsDownloadingSdkRuntimeLog] = useState(false);
	const [sdkRuntimeLogError, setSdkRuntimeLogError] = useState<string | undefined>();
	// Host-resolved preview of where a log would be written; refreshed by the host on connection or
	// setting changes and requested each time the form opens.
	const [sdkRuntimeLogLocation, setSdkRuntimeLogLocation] = useState<string | undefined>();

	// Track whether each request is in flight. Cleared when Back is clicked so a result that arrives
	// after the user has already navigated away is silently discarded.
	const pendingReportRef = useRef(false);
	const pendingApiUsageLogRef = useRef(false);
	const pendingSdkRuntimeLogRef = useRef(false);

	const openConfigReport = useCallback(() => {
		pendingReportRef.current = false;
		setIsDownloadingReport(false);
		setReportError(undefined);
		setIsLoadingTypes(true);
		requestConfigReportLocation();
		requestComponentTypes();
		if (!settingsInitializedRef.current) {
			requestSavedConfigReportSettings();
		}
		setScreen('configReport');
	}, []);

	// Reset the selection to today (UTC) on every open so a stale value never carries over across sessions.
	const openApiUsageLog = useCallback(() => {
		pendingApiUsageLogRef.current = false;
		setIsDownloadingApiUsageLog(false);
		setApiUsageLogError(undefined);
		setApiUsageLogDates([todayUtc()]);
		setApiUsageLogFormat(DEFAULT_API_USAGE_LOG_FORMAT);
		requestApiUsageLogLocation();
		setScreen('apiUsageLog');
	}, []);

	// Reset the selection to today (UTC) on every open so a stale value never carries over across sessions.
	const openSdkRuntimeLog = useCallback(() => {
		pendingSdkRuntimeLogRef.current = false;
		setIsDownloadingSdkRuntimeLog(false);
		setSdkRuntimeLogError(undefined);
		setSdkRuntimeLogDates([todayUtc()]);
		setSdkRuntimeLogFormat(DEFAULT_SDK_RUNTIME_LOG_FORMAT);
		requestSdkRuntimeLogLocation();
		setScreen('sdkRuntimeLog');
	}, []);

	useEffect(() => {
		const offSnapshot = onEnvironmentsSnapshot((snapshot) => setEnvironments(snapshot.environments));
		const offComponentTypes = onComponentTypes((types) => {
			setComponentTypes(types);
			setIsLoadingTypes(false);
		});
		const offSavedSettings = onSavedConfigReportSettings((params) => {
			if (settingsInitializedRef.current) {
				return;
			}
			settingsInitializedRef.current = true;
			if (params) {
				setReportParams(params);
				setBaselineParams(params);
			}
		});
		const offReportLocation = onConfigReportLocation(setReportLocation);
		const offReportResult = onConfigReportResult((message) => {
			if (!pendingReportRef.current) {
				return; // user already navigated away via Back — discard stale result
			}
			pendingReportRef.current = false;
			setIsDownloadingReport(false);
			if (message.status === 'success') {
				setReportError(undefined);
				setScreen('tree');
			} else {
				setReportError(message.errorMessage);
			}
		});
		const offApiUsageLogLocation = onApiUsageLogLocation(setApiUsageLogLocation);
		const offApiUsageLogResult = onApiUsageLogResult((message) => {
			if (!pendingApiUsageLogRef.current) {
				return; // user already navigated away via Back — discard stale result
			}
			pendingApiUsageLogRef.current = false;
			setIsDownloadingApiUsageLog(false);
			if (message.status === 'success') {
				setApiUsageLogError(undefined);
				setScreen('tree');
			} else {
				setApiUsageLogError(message.errorMessage);
			}
		});
		const offSdkRuntimeLogLocation = onSdkRuntimeLogLocation(setSdkRuntimeLogLocation);
		const offSdkRuntimeLogResult = onSdkRuntimeLogResult((message) => {
			if (!pendingSdkRuntimeLogRef.current) {
				return; // user already navigated away via Back — discard stale result
			}
			pendingSdkRuntimeLogRef.current = false;
			setIsDownloadingSdkRuntimeLog(false);
			if (message.status === 'success') {
				setSdkRuntimeLogError(undefined);
				setScreen('tree');
			} else {
				setSdkRuntimeLogError(message.errorMessage);
			}
		});
		requestEnvironments();
		return () => {
			offSnapshot();
			offComponentTypes();
			offSavedSettings();
			offReportLocation();
			offReportResult();
			offApiUsageLogLocation();
			offApiUsageLogResult();
			offSdkRuntimeLogLocation();
			offSdkRuntimeLogResult();
		};
	}, []);

	if (screen === 'configReport') {
		const isDirty = !paramsEqual(reportParams, baselineParams);
		const canReset = !paramsEqual(reportParams, DEFAULT_CONFIG_REPORT_PARAMETERS);
		return (
			<div className="vt-actions-panel">
				<ConfigReportForm
					params={reportParams}
					earliest={CONFIG_REPORT_EARLIEST_MODIFIED_SINCE}
					latest={todayUtc()}
					isLoading={isDownloadingReport}
					error={reportError}
					location={reportLocation}
					componentTypes={componentTypes}
					isLoadingTypes={isLoadingTypes}
					isDirty={isDirty}
					canReset={canReset}
					isSaved={isSettingsSaved}
					onParamsChange={setReportParams}
					onChangeLocation={openConfigReportSetting}
					onSaveSettings={() => {
						saveConfigReportSettings(reportParams);
						setBaselineParams(reportParams);
						setIsSettingsSaved(true);
						setTimeout(() => setIsSettingsSaved(false), 1500);
					}}
					onResetDefaults={() => setReportParams(DEFAULT_CONFIG_REPORT_PARAMETERS)}
					onDownload={() => {
						pendingReportRef.current = true;
						setReportError(undefined);
						setIsDownloadingReport(true);
						runConfigReport(reportParams);
					}}
					onBack={() => {
						if (pendingReportRef.current) {
							cancelConfigReport();
						}
						pendingReportRef.current = false;
						setIsDownloadingReport(false);
						setReportError(undefined);
						setScreen('tree');
					}}
				/>
			</div>
		);
	}

	if (screen === 'apiUsageLog') {
		// Validate against UTC now on every render so the guard reflects the clock (and any selection edit)
		// without extra state to keep in sync. The calendar's selectable window is today back to the
		// retention limit, the same bounds the validator enforces.
		const latest = todayUtc();
		const earliest = shiftUtcCalendarDay(latest, -API_USAGE_LOG_MAX_AGE_DAYS);
		const datesValidation = validateApiUsageLogDates(apiUsageLogDates, new Date());
		return (
			<div className="vt-actions-panel">
				<ApiUsageLogForm
					dates={apiUsageLogDates}
					earliest={earliest}
					latest={latest}
					logFormat={apiUsageLogFormat}
					isLoading={isDownloadingApiUsageLog}
					dateError={datesValidation.valid ? undefined : datesValidation.reason}
					error={apiUsageLogError}
					location={apiUsageLogLocation}
					canDownload={datesValidation.valid}
					onToggleDate={(date) => setApiUsageLogDates((dates) => toggleDay(dates, date))}
					onFormatChange={setApiUsageLogFormat}
					onChangeLocation={openDeveloperLogsSetting}
					onDownload={() => {
						pendingApiUsageLogRef.current = true;
						setApiUsageLogError(undefined);
						setIsDownloadingApiUsageLog(true);
						runApiUsageLog({ dates: apiUsageLogDates, logFormat: apiUsageLogFormat });
					}}
					onBack={() => {
						if (pendingApiUsageLogRef.current) {
							cancelApiUsageLog();
						}
						pendingApiUsageLogRef.current = false;
						setIsDownloadingApiUsageLog(false);
						setApiUsageLogError(undefined);
						setScreen('tree');
					}}
				/>
			</div>
		);
	}

	if (screen === 'sdkRuntimeLog') {
		// Validate against UTC now on every render so the guard reflects the clock (and any selection edit)
		// without extra state to keep in sync. The calendar's selectable window is today back to the
		// retention limit, the same bounds the validator enforces.
		const latest = todayUtc();
		const earliest = shiftUtcCalendarDay(latest, -SDK_RUNTIME_LOG_MAX_AGE_DAYS);
		const datesValidation = validateSdkRuntimeLogDates(sdkRuntimeLogDates, new Date());
		return (
			<div className="vt-actions-panel">
				<SdkRuntimeLogForm
					dates={sdkRuntimeLogDates}
					earliest={earliest}
					latest={latest}
					logFormat={sdkRuntimeLogFormat}
					isLoading={isDownloadingSdkRuntimeLog}
					dateError={datesValidation.valid ? undefined : datesValidation.reason}
					error={sdkRuntimeLogError}
					location={sdkRuntimeLogLocation}
					canDownload={datesValidation.valid}
					onToggleDate={(date) => setSdkRuntimeLogDates((dates) => toggleDay(dates, date))}
					onFormatChange={setSdkRuntimeLogFormat}
					onChangeLocation={openDeveloperLogsSetting}
					onDownload={() => {
						pendingSdkRuntimeLogRef.current = true;
						setSdkRuntimeLogError(undefined);
						setIsDownloadingSdkRuntimeLog(true);
						runSdkRuntimeLog({ dates: sdkRuntimeLogDates, logFormat: sdkRuntimeLogFormat });
					}}
					onBack={() => {
						if (pendingSdkRuntimeLogRef.current) {
							cancelSdkRuntimeLog();
						}
						pendingSdkRuntimeLogRef.current = false;
						setIsDownloadingSdkRuntimeLog(false);
						setSdkRuntimeLogError(undefined);
						setScreen('tree');
					}}
				/>
			</div>
		);
	}

	const connected = isActiveEnvironmentConnected({ environments });
	const nodes = buildActionsTree(connected, {
		onExtractMdl: () => runAction('extractMdlFromVault'),
		onExtractSdkCode: () => runAction('extractSdkCodeFromVault'),
		onDownloadConfigReport: openConfigReport,
		onDownloadApiUsageLog: openApiUsageLog,
		onDownloadSdkRuntimeLog: openSdkRuntimeLog,
	});

	return (
		<div className="vt-actions-panel">
			<Tree nodes={nodes} />
		</div>
	);
}
