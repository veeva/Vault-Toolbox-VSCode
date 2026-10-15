export type ResultViewMode = 'grid' | 'json';

/** Grid / JSON view switch for the result area. */
export function ViewToggle({
	mode,
	onChange,
}: {
	mode: ResultViewMode;
	onChange(mode: ResultViewMode): void;
}): JSX.Element {
	return (
		<div className="vt-viewtoggle" role="group" aria-label="Result view">
			<button
				type="button"
				className={`vt-viewtab${mode === 'grid' ? ' active' : ''}`}
				aria-pressed={mode === 'grid'}
				onClick={() => onChange('grid')}
			>
				Table
			</button>
			<button
				type="button"
				className={`vt-viewtab${mode === 'json' ? ' active' : ''}`}
				aria-pressed={mode === 'json'}
				onClick={() => onChange('json')}
			>
				JSON
			</button>
		</div>
	);
}
