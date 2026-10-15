interface Props {
	/** Screen-reader label describing the in-progress action (e.g. "Running", "Exporting"). */
	label?: string;
}

/** Small themed spinner (CSS keyframes live in `GlobalStyles`). */
export function Spinner({ label = 'Loading' }: Props): JSX.Element {
	return <span className="vt-spinner" role="status" aria-label={label} />;
}
