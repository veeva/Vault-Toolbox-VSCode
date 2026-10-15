import type { ApiHistoryEntry } from '../../core/rest/apiHistory';
import type { ApiHistorySink } from '../../core/rest/loggingHttpTransport';

/** Newest-first ring-buffer size; oldest entries drop once exceeded. */
export const MAX_API_HISTORY_ENTRIES = 100;

/**
 * In-memory, newest-first log of Vault API calls for the current session. Deliberately NOT persisted:
 * this is a live debugging inspector, not an audit trail, so it clears on window reload / extension
 * restart (and never writes secrets to disk). Fed by {@link LoggingHttpTransport} via the
 * {@link ApiHistorySink} it implements; consumed by the API History webview via {@link onDidAdd} /
 * {@link onDidClear}. Uses the repo's plain-listener convention (returns an unsubscribe) so it stays
 * vscode-free and unit-testable.
 */
export class ApiHistoryStore implements ApiHistorySink {
	private entries: ApiHistoryEntry[] = [];
	private readonly addListeners = new Set<(entry: ApiHistoryEntry) => void>();
	private readonly clearListeners = new Set<() => void>();

	add(entry: ApiHistoryEntry): void {
		this.entries = [entry, ...this.entries].slice(0, MAX_API_HISTORY_ENTRIES);
		for (const listener of this.addListeners) {
			listener(entry);
		}
	}

	/** The current entries, newest first. */
	snapshot(): ApiHistoryEntry[] {
		return [...this.entries];
	}

	clear(): void {
		this.entries = [];
		for (const listener of this.clearListeners) {
			listener();
		}
	}

	/** Subscribe to newly recorded entries; returns an unsubscribe. */
	onDidAdd(listener: (entry: ApiHistoryEntry) => void): () => void {
		this.addListeners.add(listener);
		return () => this.addListeners.delete(listener);
	}

	/** Subscribe to clears; returns an unsubscribe. */
	onDidClear(listener: () => void): () => void {
		this.clearListeners.add(listener);
		return () => this.clearListeners.delete(listener);
	}
}
