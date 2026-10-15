import type { ShellSurface } from '../../shared/shellProtocol';
import { requestPopOut } from '../shell/shellClient';
import { PopOutIcon } from '../shell/icons';
import { ApiHistoryPanel } from './ApiHistoryPanel';

interface ApiHistoryTabProps {
	surface: ShellSurface;
	poppedOut: boolean;
}

/**
 * The API History tab's content. In the panel surface it's just the list. In the sidebar, while the
 * list is popped out to an editor tab, it shows a placeholder instead — the panel stays mounted
 * (hidden) so its filter/expanded state and live subscription survive the round trip, keeping a
 * single visible, canonical list at a time (mirrors {@link VqlTab}).
 */
export function ApiHistoryTab({ surface, poppedOut }: ApiHistoryTabProps): JSX.Element {
	if (surface === 'panel') {
		return <ApiHistoryPanel />;
	}
	return (
		<>
			<div className="vt-fill" hidden={poppedOut}>
				<ApiHistoryPanel />
			</div>
			{poppedOut && (
				<div className="vt-placeholder">
					<p>The API History is open in an editor tab.</p>
					<button type="button" className="vt-btn" onClick={() => requestPopOut('apiHistory')}>
						<PopOutIcon /> Go to tab
					</button>
				</div>
			)}
		</>
	);
}
