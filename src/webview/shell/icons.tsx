/**
 * Tab icons backed by Phosphor (`react-icons/pi`), colored via `currentColor` so they track the
 * active VSCode theme. Wrapped rather than imported directly at call sites so callers don't need to
 * know which icon set backs a given glyph, and the mapping can change in one place.
 */
import {
	PiArrowCounterClockwise,
	PiArrowsDownUp,
	PiArrowSquareOut,
	PiCalendarBlank,
	PiCaretDownFill,
	PiCaretRightFill,
	PiDotsSixBold,
	PiClockCounterClockwise,
	PiCode,
	PiCodeBlock,
	PiDotsThreeOutline,
	PiDownloadSimple,
	PiEye,
	PiEyeSlash,
	PiFileArrowDown,
	PiFileCode,
	PiFloppyDisk,
	PiGear,
	PiGitDiff,
	PiInfo,
	PiPlug,
	PiPlugsConnected,
	PiMagnifyingGlass,
	PiPencilSimple,
	PiPower,
	PiPulse,
	PiPuzzlePiece,
	PiTerminalWindow,
	PiTrash,
	PiUsersThree,
	PiX,
} from 'react-icons/pi';

/** Marks the Environments tab (registering/switching Vault connections). */
export function EnvironmentsIcon(): JSX.Element {
	return <PiUsersThree size={18} aria-hidden="true" />;
}

/** Three dots in a rounded frame, marking the Actions tab. */
export function ActionsIcon(): JSX.Element {
	return <PiDotsThreeOutline size={18} aria-hidden="true" />;
}

/** Marks a component node in the Actions tree (MDL metadata components). */
export function ComponentsIcon(): JSX.Element {
	return <PiPuzzlePiece size={16} aria-hidden="true" />;
}

/** A magnifying glass, marking the VQL Editor tab (querying/searching the Vault). */
export function VqlIcon(): JSX.Element {
	return <PiMagnifyingGlass size={18} aria-hidden="true" />;
}

/** A clock wrapped by a counter-clockwise arrow, marking the API History tab. */
export function ApiHistoryIcon(): JSX.Element {
	return <PiClockCounterClockwise size={18} aria-hidden="true" />;
}

/** An arrow pointing out of a box, representing "Open in Editor". */
export function PopOutIcon(): JSX.Element {
	return <PiArrowSquareOut size={16} aria-hidden="true" />;
}

/** A floppy disk icon, representing "Save". */
export function SaveIcon(): JSX.Element {
	return <PiFloppyDisk size={16} aria-hidden="true" />;
}

/** A counter-clockwise arrow — the "reset to defaults" action on the Config Report form header. */
export function ResetDefaultsIcon(): JSX.Element {
	return <PiArrowCounterClockwise size={16} aria-hidden="true" />;
}

/** A code block glyph, representing "Format Query". */
export function FormatQueryIcon(): JSX.Element {
	return <PiCodeBlock size={16} aria-hidden="true" />;
}

/** A plug glyph — the "connect" action on an environment card. */
export function ConnectIcon(): JSX.Element {
	return <PiPlug size={16} aria-hidden="true" />;
}

/** Two connected plugs — the "disconnect" action on an environment card. */
export function DisconnectIcon(): JSX.Element {
	return <PiPlugsConnected size={16} aria-hidden="true" />;
}

/** A power/I-O glyph — the "set as active" action on an environment card. */
export function PowerIcon(): JSX.Element {
	return <PiPower size={16} aria-hidden="true" />;
}

/** A pencil — the "edit" action on an environment card. */
export function PencilIcon(): JSX.Element {
	return <PiPencilSimple size={16} aria-hidden="true" />;
}

/** A trash can — the "remove" action on an environment card. */
export function TrashIcon(): JSX.Element {
	return <PiTrash size={16} aria-hidden="true" />;
}

/** A gear/cog icon, representing extension settings. */
export function GearIcon(): JSX.Element {
	return <PiGear size={16} aria-hidden="true" />;
}

/** A downward arrow into a tray — the "Extract MDL from Vault" action. */
export function ExtractMdlIcon(): JSX.Element {
	return <PiDownloadSimple size={16} aria-hidden="true" />;
}

/** Angle-bracket code glyph — the "Extract Java SDK Code from Vault" action (custom `.java` source). */
export function ExtractSdkCodeIcon(): JSX.Element {
	return <PiCode size={16} aria-hidden="true" />;
}

/** Two diverging arrows — the Compare Environments tab glyph; matches the native $(diff) codicon. */
export function CompareEnvironmentsIcon(): JSX.Element {
	return <PiGitDiff size={18} aria-hidden="true" />;
}

/** A document with a download arrow — the "Download Vault Configuration Report" action. */
export function ConfigReportIcon(): JSX.Element {
	return <PiFileArrowDown size={16} aria-hidden="true" />;
}

/** A terminal window — the "Developer Logs" group in the Actions tree (diagnostic log downloads). */
export function DeveloperLogsIcon(): JSX.Element {
	return <PiTerminalWindow size={16} aria-hidden="true" />;
}

/** An activity pulse — the "Download API Usage Log" action (per-day API call metrics). */
export function ApiUsageLogIcon(): JSX.Element {
	return <PiPulse size={16} aria-hidden="true" />;
}

/** A file with a code glyph — the "Download SDK Runtime Log" action (Vault Java SDK runtime output). */
export function SdkRuntimeLogIcon(): JSX.Element {
	return <PiFileCode size={16} aria-hidden="true" />;
}

/** A circled "i" — marks a field with an explanatory tooltip summarizing its API description. */
export function InfoIcon(): JSX.Element {
	return <PiInfo size={14} aria-hidden="true" />;
}

/** A blank calendar page — marks the Config Report date popover's trigger button. */
export function CalendarIcon(): JSX.Element {
	return <PiCalendarBlank size={14} aria-hidden="true" />;
}

/** An "x" — clears the Config Report date popover's selected cutoff. */
export function ClearDateIcon(): JSX.Element {
	return <PiX size={12} aria-hidden="true" />;
}

/** Vertical up/down arrows — swaps the Compare source/target selection. */
export function SwapIcon(): JSX.Element {
	return <PiArrowsDownUp size={16} aria-hidden="true" />;
}

/** An open eye — "show password" toggle, currently hidden. */
export function EyeIcon(): JSX.Element {
	return <PiEye size={16} aria-hidden="true" />;
}

/** A slashed eye — "hide password" toggle, currently shown. */
export function EyeSlashIcon(): JSX.Element {
	return <PiEyeSlash size={16} aria-hidden="true" />;
}

/** Vertical resize grip for draggable editor surfaces. */
export function ResizeHandleIcon(): JSX.Element {
	return <PiDotsSixBold size={16} aria-hidden="true" />;
}

export function DownloadIcon(): JSX.Element {
	return <PiDownloadSimple size={16} aria-hidden="true" />;
}

/** An arrow pointing out of a box — marks the Vault DNS link as opening in the system browser. */
export function OpenExternalIcon(): JSX.Element {
	return <PiArrowSquareOut size={12} aria-hidden="true" />;
}

/** Right-pointing caret. */
export function CaretRightIcon(): JSX.Element {
	return <PiCaretRightFill size={12} aria-hidden="true" />;
}

/** Down-pointing caret (same weight as {@link CaretRightIcon}). */
export function CaretDownIcon({ size = 12 }: { size?: number } = {}): JSX.Element {
	return <PiCaretDownFill size={size} aria-hidden="true" />;
}
