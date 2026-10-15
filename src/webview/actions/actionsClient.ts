import type { ActionId, HostToActionsMessage } from '../../shared/actionsProtocol';
import type { ConfigReportParameters } from '../../core/configReport/reportParameters';
import type { ApiUsageLogParameters } from '../../core/developerLogs/apiUsageLog';
import type { SdkRuntimeLogParameters } from '../../core/developerLogs/sdkRuntimeLog';
import { onEnvelope, postEnvelope } from '../vscodeApi';

/** Trigger a fire-and-forget action by id. */
export function runAction(id: ActionId): void {
	postEnvelope('actions', { type: 'runAction', id });
}

/** Submit a Configuration Report download with the chosen parameters; the host runs the whole flow. */
export function runConfigReport(params: ConfigReportParameters): void {
	postEnvelope('actions', { type: 'runConfigReport', params });
}

/** Abort the in-flight Configuration Report started by the last {@link runConfigReport} call. */
export function cancelConfigReport(): void {
	postEnvelope('actions', { type: 'cancelConfigReport' });
}

/** Open the `vaultToolbox.ConfigReportDirectory` setting so the user can change the report save location. */
export function openConfigReportSetting(): void {
	postEnvelope('actions', { type: 'openConfigReportSetting' });
}

/** Ask the host for the current report write-location preview; the reply arrives via {@link onConfigReportLocation}. */
export function requestConfigReportLocation(): void {
	postEnvelope('actions', { type: 'requestConfigReportLocation' });
}

/** Persist `params` as the user's saved Config Report defaults (one slot, application-wide). */
export function saveConfigReportSettings(params: ConfigReportParameters): void {
	postEnvelope('actions', { type: 'saveConfigReportSettings', params });
}

/** Ask the host for the user's saved Config Report defaults; the reply arrives via {@link onSavedConfigReportSettings}. */
export function requestSavedConfigReportSettings(): void {
	postEnvelope('actions', { type: 'requestSavedConfigReportSettings' });
}

/**
 * Subscribe to the saved Config Report settings the host posts in reply to
 * {@link requestSavedConfigReportSettings}. Returns an unsubscribe function. `params` is `undefined`
 * when no settings have been saved yet.
 */
export function onSavedConfigReportSettings(
	callback: (params: ConfigReportParameters | undefined) => void,
): () => void {
	return onEnvelope('actions', (raw) => {
		const message = raw as HostToActionsMessage;
		if (message?.type === 'savedConfigReportSettings') {
			callback(message.params);
		}
	});
}

/**
 * Subscribe to the report write-location preview the host pushes on request and whenever the connection
 * or `ConfigReportDirectory` setting changes. Returns an unsubscribe function. `path` is undefined when
 * the host can't resolve a location (no connection or workspace), in which case the form omits the preview.
 */
export function onConfigReportLocation(callback: (path: string | undefined) => void): () => void {
	return onEnvelope('actions', (raw) => {
		const message = raw as HostToActionsMessage;
		if (message?.type === 'configReportLocation') {
			callback(message.path);
		}
	});
}

/**
 * Subscribe to the config-report-result message the host posts once the download completes, fails, or
 * is cancelled. Returns an unsubscribe function. The form stays visible with a spinner until this fires,
 * so its loading state and any inline error are always tied to a real host response.
 */
export function onConfigReportResult(
	callback: (message: HostToActionsMessage & { type: 'configReportResult' }) => void,
): () => void {
	return onEnvelope('actions', (raw) => {
		const message = raw as HostToActionsMessage;
		if (message?.type === 'configReportResult') {
			callback(message);
		}
	});
}

/** Submit an API Usage Log download for the chosen UTC days and format; the host runs the whole flow. */
export function runApiUsageLog(params: ApiUsageLogParameters): void {
	postEnvelope('actions', { type: 'runApiUsageLog', params });
}

/** Abort the in-flight API Usage Log download started by the last {@link runApiUsageLog} call. */
export function cancelApiUsageLog(): void {
	postEnvelope('actions', { type: 'cancelApiUsageLog' });
}

/** Open the `vaultToolbox.DeveloperLogsDirectory` setting so the user can change the log save location. */
export function openDeveloperLogsSetting(): void {
	postEnvelope('actions', { type: 'openDeveloperLogsSetting' });
}

/** Ask the host for the current log write-location preview; the reply arrives via {@link onApiUsageLogLocation}. */
export function requestApiUsageLogLocation(): void {
	postEnvelope('actions', { type: 'requestApiUsageLogLocation' });
}

/**
 * Subscribe to the log write-location preview the host pushes on request and whenever the connection or
 * `DeveloperLogsDirectory` setting changes. Returns an unsubscribe function. `path` is undefined when the
 * host can't resolve a location (no connection or workspace), in which case the form omits the preview.
 */
export function onApiUsageLogLocation(callback: (path: string | undefined) => void): () => void {
	return onEnvelope('actions', (raw) => {
		const message = raw as HostToActionsMessage;
		if (message?.type === 'apiUsageLogLocation') {
			callback(message.path);
		}
	});
}

/**
 * Subscribe to the api-usage-log-result message the host posts once the download completes, fails, or is
 * cancelled. Returns an unsubscribe function. The form stays visible with a spinner until this fires, so
 * its loading state and any inline error are always tied to a real host response.
 */
export function onApiUsageLogResult(
	callback: (message: HostToActionsMessage & { type: 'apiUsageLogResult' }) => void,
): () => void {
	return onEnvelope('actions', (raw) => {
		const message = raw as HostToActionsMessage;
		if (message?.type === 'apiUsageLogResult') {
			callback(message);
		}
	});
}

/** Submit an SDK Runtime Log download for the chosen UTC days and format; the host runs the whole flow. */
export function runSdkRuntimeLog(params: SdkRuntimeLogParameters): void {
	postEnvelope('actions', { type: 'runSdkRuntimeLog', params });
}

/** Abort the in-flight SDK Runtime Log download started by the last {@link runSdkRuntimeLog} call. */
export function cancelSdkRuntimeLog(): void {
	postEnvelope('actions', { type: 'cancelSdkRuntimeLog' });
}

/** Ask the host for the current SDK Runtime Log write-location preview; the reply arrives via {@link onSdkRuntimeLogLocation}. */
export function requestSdkRuntimeLogLocation(): void {
	postEnvelope('actions', { type: 'requestSdkRuntimeLogLocation' });
}

/**
 * Subscribe to the log write-location preview the host pushes on request and whenever the connection or
 * `DeveloperLogsDirectory` setting changes. Returns an unsubscribe function. `path` is undefined when the
 * host can't resolve a location (no connection or workspace), in which case the form omits the preview.
 */
export function onSdkRuntimeLogLocation(callback: (path: string | undefined) => void): () => void {
	return onEnvelope('actions', (raw) => {
		const message = raw as HostToActionsMessage;
		if (message?.type === 'sdkRuntimeLogLocation') {
			callback(message.path);
		}
	});
}

/**
 * Subscribe to the sdk-runtime-log-result message the host posts once the download completes, fails, or is
 * cancelled. Returns an unsubscribe function. The form stays visible with a spinner until this fires, so
 * its loading state and any inline error are always tied to a real host response.
 */
export function onSdkRuntimeLogResult(
	callback: (message: HostToActionsMessage & { type: 'sdkRuntimeLogResult' }) => void,
): () => void {
	return onEnvelope('actions', (raw) => {
		const message = raw as HostToActionsMessage;
		if (message?.type === 'sdkRuntimeLogResult') {
			callback(message);
		}
	});
}

/** Ask the host for the component types available in the connected Vault; the reply arrives via {@link onComponentTypes}. */
export function requestComponentTypes(): void {
	postEnvelope('actions', { type: 'requestComponentTypes' });
}

/**
 * Subscribe to the component types the host pushes in reply to {@link requestComponentTypes}. Returns an
 * unsubscribe function. `types` is an empty array when the host is not connected or the fetch fails —
 * the field remains creatable-only in that case.
 */
export function onComponentTypes(callback: (types: string[]) => void): () => void {
	return onEnvelope('actions', (raw) => {
		const message = raw as HostToActionsMessage;
		if (message?.type === 'componentTypes') {
			callback(message.types);
		}
	});
}
