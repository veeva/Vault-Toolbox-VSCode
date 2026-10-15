import { CaretDownIcon } from '../shell/icons';
import { useDropdownMenu } from './useDropdownMenu';

interface Props {
	entries: string[];
	onSelect(vql: string): void;
	onClear(): void;
}

/** Longest single-line preview shown per history row before it's truncated with an ellipsis. */
const PREVIEW_MAX_CHARS = 60;

/**
 * Recent-queries menu (newest first). A native `<select>`'s popup can't be themed and looks out of
 * place in a VSCode webview, so this is a toggle button + a floating, VSCode-themed list instead —
 * same visual language as the rest of the editor (`.vt-btn`, `--vscode-*` theme vars). Selecting an
 * entry loads it into the editor and closes the menu; "Clear history" sits at the bottom behind a
 * separator. Closes on an outside click or Escape. Hidden when there is no history.
 */
export function HistoryDropdown({ entries, onSelect, onClear }: Props): JSX.Element | null {
	const { open, setOpen, rootRef, menuRef } = useDropdownMenu();

	if (entries.length === 0) {
		return null;
	}

	return (
		<div className="vt-history" ref={rootRef}>
			<button
				type="button"
				className="vt-btn secondary"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((isOpen) => !isOpen)}
			>
				History <CaretDownIcon size={10} />
			</button>
			{open && (
				<div className="vt-history-menu" role="menu" ref={menuRef}>
					<div className="vt-history-items">
						{entries.map((query) => (
							<button
								key={query}
								type="button"
								role="menuitem"
								className="vt-history-item"
								title={query}
								onClick={() => {
									setOpen(false);
									onSelect(query);
								}}
							>
								{preview(query)}
							</button>
						))}
					</div>
					<div className="vt-history-sep" />
					<button
						type="button"
						role="menuitem"
						className="vt-history-item vt-history-clear"
						onClick={() => {
							setOpen(false);
							onClear();
						}}
					>
						Clear history
					</button>
				</div>
			)}
		</div>
	);
}

function preview(query: string): string {
	const oneLine = query.replace(/\s+/g, ' ').trim();
	return oneLine.length > PREVIEW_MAX_CHARS
		? `${oneLine.slice(0, PREVIEW_MAX_CHARS - 1)}…`
		: oneLine;
}
