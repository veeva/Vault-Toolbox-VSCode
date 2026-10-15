import type { ActionId, HostToActionsMessage } from '../../shared/actionsProtocol';
import type { ConfigReportParameters } from '../../core/configReport/reportParameters';
import type { ApiUsageLogParameters } from '../../core/developerLogs/apiUsageLog';
import type { SdkRuntimeLogParameters } from '../../core/developerLogs/sdkRuntimeLog';
import type { ToolboxFeatureArea } from '../../core/rest/types';
import type { RunnableConnection } from '../connection/types';
import type { ActionRunner } from '../webview/actionsBus';
import type { ConfigReportSettingsStore } from '../storage/configReportSettingsStore';
import {
	configReportDestinationLabel,
	downloadConfigReport,
	openConfigReportSetting,
} from './downloadConfigReport';
import {
	apiUsageLogDestinationLabel,
	downloadApiUsageLog,
	openDeveloperLogsSetting,
} from './downloadApiUsageLog';
import { downloadSdkRuntimeLog, sdkRuntimeLogDestinationLabel } from './downloadSdkRuntimeLog';
import { extractMdlFromVault } from './extractMdl';
import { extractSdkCodeFromVault } from './extractSdkCode';

const COMPONENT_TYPES_REFERENCE_ID: ToolboxFeatureArea = 'toolbox-actions-config-report-types';

/**
 * The host implementation of the Actions tab's runner: maps each {@link ActionId} to its native-side
 * work (Vault REST + file writes) wrapped in vscode UX. Kept out of {@link ActionsBus} so the bus
 * stays vscode-free and unit-testable. Every action runs against the currently active connection.
 */
export function createActionRunner(
	connection: RunnableConnection,
	configReportSettings: ConfigReportSettingsStore,
): ActionRunner {
	let componentTypesCache: { vaultId: number; types: string[] } | undefined;

	return {
		async run(id: ActionId): Promise<void> {
			switch (id) {
				case 'extractMdlFromVault':
					await extractMdlFromVault(connection);
					return;
				case 'extractSdkCodeFromVault':
					await extractSdkCodeFromVault(connection);
					return;
				default:
					assertNever(id);
			}
		},
		runConfigReport(params: ConfigReportParameters, signal: AbortSignal): Promise<HostToActionsMessage> {
			return downloadConfigReport(connection, params, signal);
		},
		openConfigReportSetting(): void {
			openConfigReportSetting();
		},
		configReportLocation(): string | undefined {
			return configReportDestinationLabel(connection);
		},
		saveConfigReportSettings(params: ConfigReportParameters): Promise<void> {
			return configReportSettings.save(params);
		},
		loadConfigReportSettings(): ConfigReportParameters | undefined {
			return configReportSettings.load();
		},
		runApiUsageLog(params: ApiUsageLogParameters, signal: AbortSignal): Promise<HostToActionsMessage> {
			return downloadApiUsageLog(connection, params, signal);
		},
		openDeveloperLogsSetting(): void {
			openDeveloperLogsSetting();
		},
		apiUsageLogLocation(): string | undefined {
			return apiUsageLogDestinationLabel(connection);
		},
		runSdkRuntimeLog(params: SdkRuntimeLogParameters, signal: AbortSignal): Promise<HostToActionsMessage> {
			return downloadSdkRuntimeLog(connection, params, signal);
		},
		sdkRuntimeLogLocation(): string | undefined {
			return sdkRuntimeLogDestinationLabel(connection);
		},
		async retrieveComponentTypes(): Promise<string[]> {
			const state = connection.getState();
			if (state.status !== 'connected' || state.info?.vaultId === undefined) {
				return [];
			}
			const vaultId = state.info.vaultId;
			if (componentTypesCache?.vaultId === vaultId) {
				return componentTypesCache.types;
			}
			try {
				const types = await connection.run((client) =>
					client.metadata.retrieveAllComponentTypes(COMPONENT_TYPES_REFERENCE_ID),
				);
				componentTypesCache = { vaultId, types };
				return types;
			} catch {
				return [];
			}
		},
	};
}

/** Compile-time guarantee the switch is exhaustive; a no-op at runtime. */
function assertNever(_id: never): void {
	// unreachable: every ActionId is handled above.
}
