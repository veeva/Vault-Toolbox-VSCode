/**
 * Typed message protocol for the Actions tab of the unified sidebar webview ⇄ extension host, carried
 * on the `actions` channel of the shell envelope. Kept vscode-free and DOM-free so both sides can
 * import it.
 */

import type { ConfigReportParameters } from '../core/configReport/reportParameters';
import type { ApiUsageLogParameters } from '../core/developerLogs/apiUsageLog';
import type { SdkRuntimeLogParameters } from '../core/developerLogs/sdkRuntimeLog';

/** The fire-and-forget actions a tree leaf can trigger. Extended as new actions land. */
export type ActionId = 'extractMdlFromVault' | 'extractSdkCodeFromVault';

/**
 * Actions channel: webview → host. Most leaves are a bare {@link ActionId} run. Download Configuration
 * Report, Download API Usage Log, and Download SDK Runtime Log instead carry the choices made in their
 * in-panel screens — the report parameters, or the log's date and format — so the host runs the
 * operation directly with them. Each of those long-running operations has a matching cancel message the
 * screen's Back button sends. `openDeveloperLogsSetting` is shared by both Developer Log forms, which
 * write under the same `DeveloperLogsDirectory` setting.
 */
export type ActionsToHostMessage =
	| { type: 'runAction'; id: ActionId }
	| { type: 'runConfigReport'; params: ConfigReportParameters }
	| { type: 'cancelConfigReport' }
	| { type: 'openConfigReportSetting' }
	| { type: 'requestConfigReportLocation' }
	| { type: 'saveConfigReportSettings'; params: ConfigReportParameters }
	| { type: 'requestSavedConfigReportSettings' }
	| { type: 'runApiUsageLog'; params: ApiUsageLogParameters }
	| { type: 'cancelApiUsageLog' }
	| { type: 'openDeveloperLogsSetting' }
	| { type: 'requestApiUsageLogLocation' }
	| { type: 'runSdkRuntimeLog'; params: SdkRuntimeLogParameters }
	| { type: 'cancelSdkRuntimeLog' }
	| { type: 'requestSdkRuntimeLogLocation' }
	| { type: 'requestComponentTypes' };

/**
 * Actions channel: host → webview. Reports the outcome of a Download Configuration Report or Developer
 * Log request so the originating screen can show a loading state while the host works, then either
 * dismiss on success or surface a failure inline without leaving the screen.
 *
 * `configReportLocation` / `apiUsageLogLocation` / `sdkRuntimeLogLocation` preview where the report / log
 * will be written — the workspace-relative folder, omitted when there is no connection or workspace to
 * resolve one. The host posts each in reply to the matching `request…Location` message and again whenever
 * the connection or the relevant `…Directory` setting changes, so the form's preview stays current.
 */
export type HostToActionsMessage =
	| { type: 'configReportResult'; status: 'success' }
	| { type: 'configReportResult'; status: 'error'; errorMessage: string }
	| { type: 'configReportLocation'; path?: string }
	| { type: 'savedConfigReportSettings'; params: ConfigReportParameters | undefined }
	| { type: 'apiUsageLogResult'; status: 'success' }
	| { type: 'apiUsageLogResult'; status: 'error'; errorMessage: string }
	| { type: 'apiUsageLogLocation'; path?: string }
	| { type: 'sdkRuntimeLogResult'; status: 'success' }
	| { type: 'sdkRuntimeLogResult'; status: 'error'; errorMessage: string }
	| { type: 'sdkRuntimeLogLocation'; path?: string }
	| { type: 'componentTypes'; types: string[] };
