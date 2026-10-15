import type { NormalizedError } from '../../shared/vqlProtocol';

/**
 * Inline error banner for query-level failures (bad VQL, MALFORMED_QUERY, permissions).
 * Shows the Vault error `type` + message; the editor + prior results stay put. Connection-level
 * failures surface as host toasts instead, and INVALID_SESSION_ID never reaches here (swallowed by
 * `connection.run()` recovery).
 */
export function ErrorBanner({ error }: { error: NormalizedError }): JSX.Element {
	return (
		<div className="vt-error" role="alert">
			<span className="type">{error.type}</span>: {error.message}
		</div>
	);
}
