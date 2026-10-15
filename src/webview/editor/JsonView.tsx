import type { QueryResult } from '../../core/rest/types';
import { JSON_INDENT, ReadOnlyJsonViewer } from './ReadOnlyJsonViewer';

/**
 * Raw JSON view of the current result page — the untouched response body exactly as Vault returned
 * it, pretty-printed with syntax highlighting. Useful for inspecting subquery shapes and fields the
 * grid collapses or drops. Purely a client-side view of the same page the grid renders; no host
 * round-trip. Fills the results panel, which owns the scroll area.
 */
export function JsonView({ result }: { result: QueryResult }): JSX.Element {
	return <ReadOnlyJsonViewer value={JSON.stringify(result.raw, null, JSON_INDENT)} sizing="fill" />;
}
