import type { ShellSurface } from '../../shared/shellProtocol';
import { VqlEditor } from '../editor/VqlEditor';
import { requestPopOut } from './shellClient';
import { PopOutIcon } from './icons';

interface VqlTabProps {
	surface: ShellSurface;
	poppedOut: boolean;
}

/**
 * The VQL tab's content. In the panel surface it's just the editor. In the sidebar it offers a
 * "pop out" affordance and, while the editor is popped out to an editor tab, shows a placeholder
 * instead — the editor stays mounted (hidden) so its state survives the round trip, keeping a single
 * visible, canonical editor at a time.
 */
export function VqlTab({ surface, poppedOut }: VqlTabProps): JSX.Element {
	if (surface === 'panel') {
		return <VqlEditor />;
	}
	return (
		<>
			<div className="vt-fill" hidden={poppedOut}>
				<VqlEditor onPopOut={() => requestPopOut('vql')} poppedOut={poppedOut} />
			</div>
			{poppedOut && (
				<div className="vt-placeholder">
					<p>The VQL Editor is open in an editor tab.</p>
					<button type="button" className="vt-btn" onClick={() => requestPopOut('vql')}>
						<PopOutIcon /> Go to tab
					</button>
				</div>
			)}
		</>
	);
}
