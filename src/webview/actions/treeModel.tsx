import {
	ApiUsageLogIcon,
	ComponentsIcon,
	ConfigReportIcon,
	DeveloperLogsIcon,
	ExtractMdlIcon,
	ExtractSdkCodeIcon,
	SdkRuntimeLogIcon,
} from '../shell/icons';

/** One node in the Actions tree: a parent (has `children`) or a leaf (has `onClick`). */
export interface TreeNode {
	id: string;
	label: string;
	icon?: JSX.Element;
	/** Present on parent nodes; the node then toggles expand/collapse instead of firing an action. */
	children?: TreeNode[];
	/** Present on leaf nodes; fired on click unless `disabled`. */
	onClick?: () => void;
	/** A disabled leaf renders greyed-out with {@link disabledTooltip} and ignores clicks. */
	disabled?: boolean;
	disabledTooltip?: string;
}

/** The message shown on gated leaves when no environment is connected. */
const CONNECT_HINT = 'Connect an environment to use this action.';

/** What each Actions leaf runs; wired to the host action bus by the panel. */
export interface ActionHandlers {
	onExtractMdl: () => void;
	onExtractSdkCode: () => void;
	onDownloadConfigReport: () => void;
	onDownloadApiUsageLog: () => void;
	onDownloadSdkRuntimeLog: () => void;
}

/**
 * The Actions tree content. Two groups: Components — the Extract-MDL, Extract-SDK-Code, and
 * Download-Config-Report leaves (all gated on an active connection) — and Developer Logs, with the
 * Download-API-Usage-Log and Download-SDK-Runtime-Log leaves (both gated on an active connection).
 * `isConnected` toggles the connection gate. (Compare Environments is its own top-level tab, not a leaf
 * here.)
 */
export function buildActionsTree(isConnected: boolean, handlers: ActionHandlers): TreeNode[] {
	return [
		{
			id: 'components',
			label: 'Components',
			icon: <ComponentsIcon />,
			children: [
				{
					id: 'extractMdlFromVault',
					label: 'Extract MDL from Vault',
					icon: <ExtractMdlIcon />,
					onClick: handlers.onExtractMdl,
					disabled: !isConnected,
					disabledTooltip: CONNECT_HINT,
				},
				{
					id: 'extractSdkCodeFromVault',
					label: 'Extract Java SDK Code from Vault',
					icon: <ExtractSdkCodeIcon />,
					onClick: handlers.onExtractSdkCode,
					disabled: !isConnected,
					disabledTooltip: CONNECT_HINT,
				},
				{
					id: 'downloadConfigReport',
					label: 'Download Vault Configuration Report',
					icon: <ConfigReportIcon />,
					onClick: handlers.onDownloadConfigReport,
					disabled: !isConnected,
					disabledTooltip: CONNECT_HINT,
				},
			],
		},
		{
			id: 'developerLogs',
			label: 'Developer Logs',
			icon: <DeveloperLogsIcon />,
			children: [
				{
					id: 'downloadApiUsageLog',
					label: 'Download API Usage Log',
					icon: <ApiUsageLogIcon />,
					onClick: handlers.onDownloadApiUsageLog,
					disabled: !isConnected,
					disabledTooltip: CONNECT_HINT,
				},
				{
					id: 'downloadSdkRuntimeLog',
					label: 'Download SDK Runtime Log',
					icon: <SdkRuntimeLogIcon />,
					onClick: handlers.onDownloadSdkRuntimeLog,
					disabled: !isConnected,
					disabledTooltip: CONNECT_HINT,
				},
			],
		},
	];
}
