import { useEffect, useState } from 'react';
import type { SavedQuery } from '../../shared/vqlProtocol';
import { CaretDownIcon } from '../shell/icons';
import { useDropdownMenu } from './useDropdownMenu';

interface Props {
	entries: SavedQuery[];
	onSelect(vql: string): void;
	onDelete(name: string): void;
}

/**
 * Named saved-queries menu (newest first) — the deliberate counterpart to the recent-history
 * dropdown. Same floating, VSCode-themed pattern as {@link HistoryDropdown}: a toggle button + a
 * clamped menu that closes on outside click / Escape. Each row loads its query into the editor;
 * a trailing "×" deletes it. Hidden when there are no saved queries.
 *
 * A filter input at the top of the open menu narrows the list by name (case-insensitive substring).
 * It auto-focuses on open and clears when the menu closes.
 */
export function SavedQueriesDropdown({ entries, onSelect, onDelete }: Props): JSX.Element | null {
	const { open, setOpen, rootRef, menuRef } = useDropdownMenu();
	const [search, setSearch] = useState('');

	useEffect(() => {
		if (!open) setSearch('');
	}, [open]);

	if (entries.length === 0) {
		return null;
	}

	const lowerSearch = search.toLowerCase();
	const filtered = search ? entries.filter((e) => e.name.toLowerCase().includes(lowerSearch)) : entries;

	return (
		<div className="vt-history" ref={rootRef}>
			<button
				type="button"
				className="vt-btn secondary"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((isOpen) => !isOpen)}
			>
				Saved <CaretDownIcon size={10} />
			</button>
			{open && (
				<div className="vt-history-menu" role="menu" ref={menuRef}>
					<div className="vt-saved-search-wrap">
						<input
							// eslint-disable-next-line jsx-a11y/no-autofocus
							autoFocus
							type="text"
							className="vt-saved-search"
							placeholder="Filter saved queries…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							aria-label="Filter saved queries"
						/>
					</div>
					<div className="vt-history-items">
						{filtered.length > 0 ? (
							filtered.map((entry) => (
								<div className="vt-saved-row" key={entry.name}>
									<button
										type="button"
										role="menuitem"
										className="vt-history-item"
										title={entry.vql}
										onClick={() => {
											setOpen(false);
											onSelect(entry.vql);
										}}
									>
										{entry.name}
									</button>
									<button
										type="button"
										className="vt-saved-del"
										title={`Delete "${entry.name}"`}
										aria-label={`Delete ${entry.name}`}
										onClick={() => onDelete(entry.name)}
									>
										×
									</button>
								</div>
							))
						) : (
							<p className="vt-saved-no-results">No saved queries match &ldquo;{search}&rdquo;</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
