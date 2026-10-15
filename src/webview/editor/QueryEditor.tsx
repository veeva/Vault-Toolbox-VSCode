import { forwardRef, type ReactNode } from 'react';
import { MonacoEditor, type MonacoEditorHandle } from './MonacoEditor';
import { FormatQueryIcon, SaveIcon } from '../shell/icons';

interface Props {
	value: string;
	onChange(value: string): void;
	onRun(): void;
	/** Reformat the current query in place (VQL formatter). */
	onFormat(): void;
	/** Save the current query (the host prompts for a name). */
	onSave(): void;
	/** Optional toolbar content (the saved-queries dropdown). */
	savedSlot?: ReactNode;
	/** Optional toolbar content (the recent-queries dropdown). */
	historySlot?: ReactNode;
}

/**
 * VQL editor toolbar controls. Keyboard shortcut runs the query (Monaco editor handles ⌘/Ctrl+Enter).
 * The bottom toolbar's left group houses the "Format Query" (code-block) and "Save Query" (floppy disk)
 * icon buttons; the right group houses the saved/recent queries dropdown slots.
 */
export const QueryEditor = forwardRef<MonacoEditorHandle, Props>(function QueryEditor(
	{ value, onChange, onRun, onFormat, onSave, savedSlot, historySlot },
	ref,
): JSX.Element {
	const empty = value.trim().length === 0;

	return (
		<div>
			<MonacoEditor ref={ref} value={value} onChange={onChange} onRun={onRun} />
			<div className="vt-toolbar">
				<div className="vt-toolbar-left">
					<button
						type="button"
						className="vt-btn secondary icon-only"
						onClick={onFormat}
						disabled={empty}
						data-tooltip="Format Query"
						data-tooltip-align="left"
					>
						<FormatQueryIcon />
					</button>
					<button
						type="button"
						className="vt-btn secondary icon-only"
						onClick={onSave}
						disabled={empty}
						data-tooltip="Save Query"
						data-tooltip-align="left"
					>
						<SaveIcon />
					</button>
				</div>
				<div className="vt-toolbar-right">
					{savedSlot}
					{historySlot}
				</div>
			</div>
		</div>
	);
});
