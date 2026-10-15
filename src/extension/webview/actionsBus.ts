import type {
	ActionId,
	ActionsToHostMessage,
	HostToActionsMessage,
} from '../../shared/actionsProtocol';
import { AbortSlot } from './abortSlot';
import type { ConfigReportParameters } from '../../core/configReport/reportParameters';
import type { ApiUsageLogParameters } from '../../core/developerLogs/apiUsageLog';
import type { SdkRuntimeLogParameters } from '../../core/developerLogs/sdkRuntimeLog';

/** Runs the Actions-tab work; the host supplies the real (vscode-dependent) implementation. */
export interface ActionRunner {
	/** Run one fire-and-forget action by id. */
	run(id: ActionId): Promise<void>;
	/**
	 * Download a Configuration Report with the parameters chosen in the tab's Config Report screen.
	 * The signal is aborted when the user cancels via Back or the progress notification. Returns the
	 * result message to post back, which the bus suppresses if aborted.
	 */
	runConfigReport(params: ConfigReportParameters, signal: AbortSignal): Promise<HostToActionsMessage>;
	/** Open the `vaultToolbox.ConfigReportDirectory` setting so the user can change the save location. */
	openConfigReportSetting(): void;
	/**
	 * The workspace-relative folder a Configuration Report would be written to now, for the form's
	 * preview. Undefined when it can't be resolved (no connection or workspace).
	 */
	configReportLocation(): string | undefined;
	/** Persist `params` as the user's saved Config Report defaults (one slot, application-wide). */
	saveConfigReportSettings(params: ConfigReportParameters): Promise<void>;
	/** Load the user's saved Config Report defaults, or `undefined` if none have been saved. */
	loadConfigReportSettings(): ConfigReportParameters | undefined;
	/**
	 * Download the API Usage Log for the UTC day and format chosen in the tab's API Usage Log screen. The
	 * signal is aborted when the user cancels via Back or the progress notification. Returns the result
	 * message to post back, which the bus suppresses if aborted.
	 */
	runApiUsageLog(params: ApiUsageLogParameters, signal: AbortSignal): Promise<HostToActionsMessage>;
	/** Open the `vaultToolbox.DeveloperLogsDirectory` setting so the user can change the save location. */
	openDeveloperLogsSetting(): void;
	/**
	 * The workspace-relative folder an API Usage Log would be written to now, for the form's preview.
	 * Undefined when it can't be resolved (no connection or workspace).
	 */
	apiUsageLogLocation(): string | undefined;
	/**
	 * Download the SDK Runtime Log for the UTC day and format chosen in the tab's SDK Runtime Log screen.
	 * The signal is aborted when the user cancels via Back or the progress notification. Returns the result
	 * message to post back, which the bus suppresses if aborted.
	 */
	runSdkRuntimeLog(params: SdkRuntimeLogParameters, signal: AbortSignal): Promise<HostToActionsMessage>;
	/**
	 * The workspace-relative folder an SDK Runtime Log would be written to now, for the form's preview.
	 * Undefined when it can't be resolved (no connection or workspace).
	 */
	sdkRuntimeLogLocation(): string | undefined;
	/**
	 * The component types available in the connected Vault, fetched lazily and cached by vault id. Returns
	 * an empty array when not connected or the fetch fails — the Config Report field stays creatable-only.
	 */
	retrieveComponentTypes(): Promise<string[]>;
}

export interface ActionsBusDeps {
	runner: ActionRunner;
	/** Post a message back to the webview on the actions channel. */
	post(message: HostToActionsMessage): void;
}

/**
 * Routes Actions-tab webview messages onto the injected {@link ActionRunner}. Bidirectional: the
 * webview sends action requests and the host posts download results back. Holds one
 * {@link AbortController} per long-running download so its cancel message can abort it before its result
 * is committed or posted.
 */
export class ActionsBus {
	private readonly configReportSlot = new AbortSlot();
	private readonly apiUsageLogSlot = new AbortSlot();
	private readonly sdkRuntimeLogSlot = new AbortSlot();

	constructor(private readonly deps: ActionsBusDeps) {}

	/**
	 * Push the current report write-location preview to the webview. Called when the connection or the
	 * `ConfigReportDirectory` setting changes so an open form reflects the change without asking.
	 */
	pushConfigReportLocation(): void {
		this.deps.post({ type: 'configReportLocation', path: this.deps.runner.configReportLocation() });
	}

	/**
	 * Push the current API Usage Log write-location preview to the webview. Called when the connection or
	 * the `DeveloperLogsDirectory` setting changes so an open form reflects the change without asking.
	 */
	pushApiUsageLogLocation(): void {
		this.deps.post({ type: 'apiUsageLogLocation', path: this.deps.runner.apiUsageLogLocation() });
	}

	/**
	 * Push the current SDK Runtime Log write-location preview to the webview. Called when the connection or
	 * the `DeveloperLogsDirectory` setting changes so an open form reflects the change without asking.
	 */
	pushSdkRuntimeLogLocation(): void {
		this.deps.post({ type: 'sdkRuntimeLogLocation', path: this.deps.runner.sdkRuntimeLogLocation() });
	}

	async handle(message: unknown): Promise<void> {
		if (!isValidMessage(message)) {
			// Drop malformed/untrusted input, mirroring the other buses: the compile-time union is not
			// enforced at runtime, and a buggy or compromised webview must not flow junk into the runner.
			return;
		}
		await this.dispatch(message);
	}

	private async dispatch(message: ActionsToHostMessage): Promise<void> {
		switch (message.type) {
			case 'runAction':
				await this.deps.runner.run(message.id);
				return;
			case 'runConfigReport':
				await this.configReportSlot.run(
					(signal) => this.deps.runner.runConfigReport(message.params, signal),
					this.deps.post,
				);
				return;
			case 'cancelConfigReport':
				this.configReportSlot.abort();
				return;
			case 'openConfigReportSetting':
				this.deps.runner.openConfigReportSetting();
				return;
			case 'requestConfigReportLocation':
				this.pushConfigReportLocation();
				return;
			case 'saveConfigReportSettings':
				await this.deps.runner.saveConfigReportSettings(message.params);
				return;
			case 'requestSavedConfigReportSettings': {
				const params = this.deps.runner.loadConfigReportSettings();
				this.deps.post({ type: 'savedConfigReportSettings', params });
				return;
			}
			case 'runApiUsageLog':
				await this.apiUsageLogSlot.run(
					(signal) => this.deps.runner.runApiUsageLog(message.params, signal),
					this.deps.post,
				);
				return;
			case 'cancelApiUsageLog':
				this.apiUsageLogSlot.abort();
				return;
			case 'openDeveloperLogsSetting':
				this.deps.runner.openDeveloperLogsSetting();
				return;
			case 'requestApiUsageLogLocation':
				this.pushApiUsageLogLocation();
				return;
			case 'runSdkRuntimeLog':
				await this.sdkRuntimeLogSlot.run(
					(signal) => this.deps.runner.runSdkRuntimeLog(message.params, signal),
					this.deps.post,
				);
				return;
			case 'cancelSdkRuntimeLog':
				this.sdkRuntimeLogSlot.abort();
				return;
			case 'requestSdkRuntimeLogLocation':
				this.pushSdkRuntimeLogLocation();
				return;
			case 'requestComponentTypes': {
				const types = await this.deps.runner.retrieveComponentTypes();
				this.deps.post({ type: 'componentTypes', types });
				return;
			}
			default:
				assertNever(message);
		}
	}
}

/** Compile-time guarantee the dispatch switch is exhaustive; a no-op at runtime. */
function assertNever(_type: never): void {
	// unreachable: every ActionsToHostMessage variant is handled above.
}

/**
 * Validate an untrusted `runConfigReport` payload: the four booleans and the output format must be
 * present and well-typed; the two optional scoping fields, when present, must be a string / string
 * array. The pure encoder trims and drops empties, so no value-level checks are needed here.
 */
function isConfigReportParameters(value: unknown): value is ConfigReportParameters {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const params = value as Record<string, unknown>;
	const booleansValid =
		typeof params.includeVaultSettings === 'boolean' &&
		typeof params.includeInactiveComponents === 'boolean' &&
		typeof params.includeDocBinderTemplates === 'boolean' &&
		typeof params.suppressEmptyResults === 'boolean';
	const formatValid =
		params.outputFormat === 'Excel' || params.outputFormat === 'Excel_Macro_Enabled';
	const modifiedSinceValid =
		params.modifiedSince === undefined || typeof params.modifiedSince === 'string';
	const componentTypesValid =
		params.componentTypes === undefined ||
		(Array.isArray(params.componentTypes) &&
			params.componentTypes.every((type) => typeof type === 'string'));
	return booleansValid && formatValid && modifiedSinceValid && componentTypesValid;
}

/**
 * Validate an untrusted `runApiUsageLog` payload: a `dates` array of strings and a known `logFormat`. The
 * dates' calendar validity is the form's concern (see `validateApiUsageLogDates`); here we only guard the
 * shape so a buggy or compromised webview can't flow junk into the runner.
 */
function isApiUsageLogParameters(value: unknown): value is ApiUsageLogParameters {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const params = value as Record<string, unknown>;
	const datesValid =
		Array.isArray(params.dates) && params.dates.every((date) => typeof date === 'string');
	return datesValid && (params.logFormat === 'csv' || params.logFormat === 'logfile');
}

/**
 * Validate an untrusted `runSdkRuntimeLog` payload: a `dates` array of strings and a known `logFormat`. The
 * dates' calendar validity is the form's concern (see `validateSdkRuntimeLogDates`); here we only guard the
 * shape so a buggy or compromised webview can't flow junk into the runner.
 */
function isSdkRuntimeLogParameters(value: unknown): value is SdkRuntimeLogParameters {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const params = value as Record<string, unknown>;
	const datesValid =
		Array.isArray(params.dates) && params.dates.every((date) => typeof date === 'string');
	return datesValid && (params.logFormat === 'csv' || params.logFormat === 'logfile');
}

/** The action ids the host knows how to run; keep in sync with {@link ActionId}. */
const KNOWN_ACTION_IDS: readonly ActionId[] = ['extractMdlFromVault', 'extractSdkCodeFromVault'];

/**
 * Validate an untrusted webview message at runtime: a known `type` with the fields that variant
 * requires. Anything else is dropped by {@link ActionsBus.handle}.
 */
function isValidMessage(message: unknown): message is ActionsToHostMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}
	const fields = message as Record<string, unknown>;
	switch (fields.type) {
		case 'runAction':
			return KNOWN_ACTION_IDS.includes(fields.id as ActionId);
		case 'runConfigReport':
			return isConfigReportParameters(fields.params);
		case 'cancelConfigReport':
			return true;
		case 'openConfigReportSetting':
			return true;
		case 'requestConfigReportLocation':
			return true;
		case 'saveConfigReportSettings':
			return isConfigReportParameters(fields.params);
		case 'requestSavedConfigReportSettings':
			return true;
		case 'runApiUsageLog':
			return isApiUsageLogParameters(fields.params);
		case 'cancelApiUsageLog':
			return true;
		case 'openDeveloperLogsSetting':
			return true;
		case 'requestApiUsageLogLocation':
			return true;
		case 'runSdkRuntimeLog':
			return isSdkRuntimeLogParameters(fields.params);
		case 'cancelSdkRuntimeLog':
			return true;
		case 'requestSdkRuntimeLogLocation':
			return true;
		case 'requestComponentTypes':
			return true;
		default:
			return false;
	}
}
