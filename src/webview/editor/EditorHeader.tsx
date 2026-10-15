import type { ConnectionSnapshot } from '../../shared/vqlProtocol';
import { PopOutIcon } from '../shell/icons';

interface EditorHeaderProps {
	connection?: ConnectionSnapshot;
	onPopOut?(): void;
	actionsSlot?: React.ReactNode;
}

/**
 * Panel header: title, PRODUCTION badge when connected to Prod, and header actions (like pop out).
 */
export function EditorHeader({
	connection,
	onPopOut,
	actionsSlot,
}: EditorHeaderProps): JSX.Element {
	const connected = connection?.status === 'connected';
	return (
		<header className="vt-header">
			<div className="vt-header-left">
				<span className="title">VQL Editor</span>
				{onPopOut && (
					<button
						type="button"
						className="vt-header-action-btn"
						data-tooltip="Open in Editor"
						data-tooltip-dir="below"
						onClick={onPopOut}
					>
						<PopOutIcon />
					</button>
				)}
				{connected && connection?.isProduction && (
					<span className="vt-badge production">Production</span>
				)}
			</div>
			{actionsSlot && <div className="vt-header-right">{actionsSlot}</div>}
		</header>
	);
}
