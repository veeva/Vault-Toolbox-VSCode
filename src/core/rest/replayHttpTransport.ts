import type { HttpRequest, HttpTransport, VaultHttpResponse } from './types';

/**
 * A single recorded Vault exchange. `request` carries only the fields the matcher keys on (method,
 * url, serialized body); `response` is enough to rebuild a {@link VaultHttpResponse}. Cassettes are
 * plain JSON arrays of these, committed alongside the E2E journeys.
 */
export interface CassetteEntry {
	request: {
		method: HttpRequest['method'];
		url: string;
		/** Request body serialized to a string (URLSearchParams via `.toString()`); omitted for GETs. */
		body?: string;
	};
	response: {
		status: number;
		headers: Record<string, string>;
		body: unknown;
	};
}

/** Where {@link RecordingHttpTransport} sends captured exchanges; the host supplies a file writer. */
export interface CassetteSink {
	add(entry: CassetteEntry): void;
}

/**
 * Wrapper the cassette stores in place of a binary (`Uint8Array`) response body. JSON can't carry a
 * `Uint8Array`, so a recorded binary body would come back a plain object on `JSON.parse` and fail the
 * `body instanceof Uint8Array` check every binary endpoint (e.g. `GET /code/{class}`) relies on. The
 * only binary bodies we cassette are UTF-8 text (Java SDK source), so we store the decoded text rather
 * than base64 — the cassette stays human-readable, which matters because these `.java` bodies are
 * hand-scrubbed after recording. {@link decodeResponseBody} rebuilds the `Uint8Array` on replay.
 */
interface CassetteBinaryBody {
	__cassetteBinaryUtf8__: string;
}

function isCassetteBinaryBody(body: unknown): body is CassetteBinaryBody {
	return (
		typeof body === 'object' &&
		body !== null &&
		typeof (body as CassetteBinaryBody).__cassetteBinaryUtf8__ === 'string'
	);
}

/** Wraps a `Uint8Array` response body as readable text for the cassette; passes anything else through. */
export function encodeResponseBody(body: unknown): unknown {
	if (body instanceof Uint8Array) {
		return { __cassetteBinaryUtf8__: new TextDecoder().decode(body) } satisfies CassetteBinaryBody;
	}
	return body;
}

/** Rebuilds a `Uint8Array` from a {@link CassetteBinaryBody} wrapper; passes anything else through. */
export function decodeResponseBody(body: unknown): unknown {
	if (isCassetteBinaryBody(body)) {
		return new TextEncoder().encode(body.__cassetteBinaryUtf8__);
	}
	return body;
}

/** Serializes a request body to the stable string the matcher and cassettes key on. */
export function serializeCassetteBody(body: HttpRequest['body']): string | undefined {
	if (body === undefined) {
		return undefined;
	}
	if (body instanceof URLSearchParams) {
		return body.toString();
	}
	// A `Uint8Array` body is the multipart SDK-code upload; decode it as UTF-8 so cassettes key on a
	// stable string, matching how the API History log serializes it.
	return body instanceof Uint8Array ? new TextDecoder().decode(body) : body;
}

function matchKey(method: string, url: string, body: string | undefined): string {
	return `${method} ${url} ${body ?? ''}`;
}

/**
 * Rebuilds a live-shaped {@link VaultHttpResponse} from a recorded one, restoring the
 * case-insensitive `getHeader` lookup the client relies on.
 */
function toHttpResponse(recorded: CassetteEntry['response']): VaultHttpResponse {
	const lower = new Map(
		Object.entries(recorded.headers).map(([name, value]) => [name.toLowerCase(), value]),
	);
	return {
		status: recorded.status,
		headers: recorded.headers,
		getHeader: (name) => lower.get(name.toLowerCase()),
		body: decodeResponseBody(recorded.body),
	};
}

/**
 * Replays a committed cassette instead of hitting the network, so E2E journeys run deterministically
 * over the proven {@link HttpTransport} seam. Requests are matched by method + url + serialized body;
 * when the same request recurs (e.g. a repeated handshake), successive matches are consumed in the
 * order they were recorded, so paginated flows replay page-by-page.
 */
export class ReplayHttpTransport implements HttpTransport {
	private readonly cursors = new Map<string, number>();

	constructor(private readonly entries: readonly CassetteEntry[]) {}

	async send(req: HttpRequest): Promise<VaultHttpResponse> {
		const key = matchKey(req.method, req.url, serializeCassetteBody(req.body));
		const matches = this.entries.filter(
			(entry) =>
				matchKey(entry.request.method, entry.request.url, entry.request.body) === key,
		);
		if (matches.length === 0) {
			throw new Error(`No cassette entry matches ${req.method} ${req.url}`);
		}
		const cursor = this.cursors.get(key) ?? 0;
		const entry = matches[Math.min(cursor, matches.length - 1)];
		this.cursors.set(key, cursor + 1);
		return toHttpResponse(entry.response);
	}
}

/**
 * Transport decorator that captures every exchange to a {@link CassetteSink} while passing the real
 * response straight through — shaped like `LoggingHttpTransport`. Wrap the real transport with this
 * once against a sandbox Vault to author a cassette, then commit the sink's output.
 */
export class RecordingHttpTransport implements HttpTransport {
	constructor(
		private readonly inner: HttpTransport,
		private readonly sink: CassetteSink,
	) {}

	async send(req: HttpRequest, timeoutMs?: number): Promise<VaultHttpResponse> {
		const response = await this.inner.send(req, timeoutMs);
		this.sink.add({
			request: {
				method: req.method,
				url: req.url,
				body: serializeCassetteBody(req.body),
			},
			response: {
				status: response.status,
				headers: response.headers,
				body: encodeResponseBody(response.body),
			},
		});
		return response;
	}
}
