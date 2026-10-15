import {
	redactRequestHeaders,
	serializeRequestBody,
	serializeResponseBody,
	type ApiHistoryEntry,
} from './apiHistory';
import { VaultApiError } from './errors';
import type { HttpRequest, HttpTransport, VaultHttpResponse } from './types';

/** Where recorded entries go; the extension host supplies the in-memory store. */
export interface ApiHistorySink {
	add(entry: ApiHistoryEntry): void;
}

export interface LoggingTransportContext {
	envId: string;
	envLabel: string;
	sink: ApiHistorySink;
	/** Injectable for deterministic tests; defaults to `Date.now`. */
	now?: () => number;
	/** Injectable for deterministic tests; defaults to a monotonic counter + timestamp. */
	makeId?: () => string;
}

let idCounter = 0;

/**
 * Transport decorator that records every Vault call to an {@link ApiHistorySink} without altering it.
 * Wraps the real transport per connection (so it carries that connection's environment id/label) and
 * is transparent: it records both success and failure, then returns the response or re-throws the error
 * exactly as the inner transport produced it.
 */
export class LoggingHttpTransport implements HttpTransport {
	constructor(
		private readonly inner: HttpTransport,
		private readonly context: LoggingTransportContext,
	) {}

	async send(req: HttpRequest, timeoutMs?: number): Promise<VaultHttpResponse> {
		const startedAt = this.now();
		try {
			const response = await this.inner.send(req, timeoutMs);
			this.record(req, startedAt, {
				responseStatus: response.status,
				responseHeaders: response.headers,
				responseBody: serializeResponseBody(response.body, req.url, response.headers),
			});
			return response;
		} catch (error) {
			this.record(req, startedAt, {
				responseStatus: null,
				responseHeaders: {},
				responseBody: null,
				error: toErrorInfo(error),
			});
			throw error;
		}
	}

	private record(
		req: HttpRequest,
		startedAt: number,
		outcome: Pick<
			ApiHistoryEntry,
			'responseStatus' | 'responseHeaders' | 'responseBody' | 'error'
		>,
	): void {
		const endedAt = this.now();
		this.context.sink.add({
			id: this.makeId(),
			timestamp: new Date(startedAt).toISOString(),
			durationMs: Math.max(0, endedAt - startedAt),
			envId: this.context.envId,
			envLabel: this.context.envLabel,
			method: req.method,
			url: req.url,
			requestHeaders: redactRequestHeaders(req.headers),
			requestBody: serializeRequestBody(req.body, req.url),
			...outcome,
		});
	}

	private now(): number {
		return (this.context.now ?? Date.now)();
	}

	private makeId(): string {
		if (this.context.makeId) {
			return this.context.makeId();
		}
		idCounter += 1;
		return `${Date.now()}-${idCounter}`;
	}
}

function toErrorInfo(error: unknown): { type: string; message: string } {
	if (error instanceof VaultApiError) {
		return { type: error.type, message: error.message };
	}
	if (error instanceof Error) {
		return { type: error.name, message: error.message };
	}
	return { type: 'UNKNOWN', message: String(error) };
}
