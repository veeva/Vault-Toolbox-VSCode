/**
 * Pure helpers + types for the API History feature: turning a request/response pair into a stored,
 * secret-redacted {@link ApiHistoryEntry}, plus the display formatting the webview reuses.
 *
 * Kept vscode-free AND browser-safe (no `node:` imports, no `Buffer`) so the webview bundle can import
 * the same formatting helpers the host uses to build entries.
 */

const REDACTED = '***';
const AUTH_PATH_SUFFIX = '/auth';
const AUTH_REDACTED_FIELDS = ['username', 'password'] as const;

/** One recorded Vault API call. Secrets are already redacted. */
export interface ApiHistoryEntry {
	id: string;
	/** ISO 8601 UTC string of when the request was initiated (`new Date().toISOString()`). */
	timestamp: string;
	durationMs: number;
	envId: string;
	envLabel: string;
	method: string;
	url: string;
	requestHeaders: Record<string, string>;
	requestBody: string | null;
	/** HTTP status, or `null` when the call failed before a response (network error / timeout). */
	responseStatus: number | null;
	responseHeaders: Record<string, string>;
	responseBody: string | null;
	/** Present only when the call threw before a response. */
	error?: { type: string; message: string };
}

/** True when the URL targets the `/auth` endpoint, whose request/response carry credentials + session. */
export function isAuthUrl(url: string): boolean {
	return pathOf(url).endsWith(AUTH_PATH_SUFFIX);
}

/** True when the headers advertise a JSON body via `Content-Type` (header name matched case-insensitively). */
export function isJsonContentType(headers: Record<string, string>): boolean {
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === 'content-type') {
			return value.toLowerCase().includes('application/json');
		}
	}
	return false;
}

/** Copy request headers, dropping `Authorization` (which carries the Vault session token). */
export function redactRequestHeaders(headers: Record<string, string> | undefined): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers ?? {})) {
		if (name.toLowerCase() === 'authorization') {
			continue;
		}
		result[name] = value;
	}
	return result;
}

/**
 * Serialize a request body to storable text, redacting `username`/`password` on the auth endpoint.
 * Returns `null` for an absent body.
 */
export function serializeRequestBody(
	body: string | URLSearchParams | Uint8Array | undefined,
	url: string,
): string | null {
	if (body == null) {
		return null;
	}
	// A `Uint8Array` body is the `multipart/form-data` SDK-code upload — decode it as UTF-8 so the
	// assembled parts (and the `.java` source) are readable in the API History inspector.
	const text =
		body instanceof URLSearchParams
			? body.toString()
			: body instanceof Uint8Array
				? new TextDecoder().decode(body)
				: body;
	return isAuthUrl(url) ? redactFormCredentials(text) : text;
}

/**
 * Serialize a parsed response body to storable text, redacting the auth endpoint's `sessionId`.
 * Returns `null` for an absent body. The session id is a live credential — API History stays
 * visible in the UI (and can end up in a screenshot) well beyond the moment of login, so it's
 * blanked the same way the auth request's `username`/`password` are.
 *
 * A `Uint8Array` body came from a `binary` request. When the response is genuinely binary (a report ZIP,
 * a `.java` file) its byte array is recorded only as a size — stringifying it would bloat the log with an
 * index map. But a binary-requested endpoint can answer with a **JSON error envelope** instead of the
 * expected bytes (e.g. `GET /code` returns a FAILURE envelope with HTTP 200 for a class whose source
 * isn't retrievable); `responseHeaders` advertises `application/json` there, so decode it as text and
 * record the real reason rather than an opaque `[binary N bytes]`.
 */
export function serializeResponseBody(
	body: unknown,
	url: string,
	responseHeaders?: Record<string, string>,
): string | null {
	if (body == null) {
		return null;
	}
	if (body instanceof Uint8Array) {
		if (responseHeaders && isJsonContentType(responseHeaders)) {
			return new TextDecoder().decode(body);
		}
		return `[binary ${body.byteLength} bytes]`;
	}
	const redacted = isAuthUrl(url) ? redactAuthResponseSessionId(body) : body;
	const text = typeof redacted === 'string' ? redacted : safeStringify(redacted);
	return text === '' ? null : text;
}

/** Strip the Vault origin (scheme + host + port) from a URL, leaving `pathname + search` for a compact endpoint label. */
export function stripOrigin(url: string): string {
	const parsed = tryParseUrl(url);
	return parsed ? `${parsed.pathname}${parsed.search}` : url;
}

/** Short status token for display: the numeric status, or `ERR` when the call never got one. */
export function statusLabel(status: number | null): string {
	return status == null ? 'ERR' : String(status);
}

/** CSS-class suffix for an HTTP method badge (e.g. `get`, `post`), lowercased. */
export function methodClass(method: string): string {
	return method.toLowerCase();
}

/** CSS-class suffix for a status badge, bucketed by range; `error` when the call never got a status. */
export function statusClass(status: number | null): string {
	if (status == null) {
		return 'error';
	}
	if (status >= 500) {
		return 'server-error';
	}
	if (status >= 400) {
		return 'client-error';
	}
	if (status >= 300) {
		return 'redirect';
	}
	return 'ok';
}

/** `N ms` below a second, `N.NN s` above. */
export function formatDuration(durationMs: number): string {
	if (durationMs < 1000) {
		return `${Math.round(durationMs)} ms`;
	}
	return `${(durationMs / 1000).toFixed(2)} s`;
}

/**
 * Formats an ISO 8601 UTC timestamp to a user-friendly local date/time string:
 * `YYYY-MM-DD HH:MM:SS TZ` (e.g. `2026-08-14 09:30:05 PDT`).
 */
export function formatDateTime(utcDateTimeString: string): string {
	const date = new Date(utcDateTimeString);

	const formatter = new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		timeZoneName: 'short',
	});

	const parts = formatter.formatToParts(date);
	const get = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((p) => p.type === type)?.value ?? '';

	return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${get('timeZoneName')}`;
}

function redactFormCredentials(formText: string): string {
	const params = new URLSearchParams(formText);
	for (const field of AUTH_REDACTED_FIELDS) {
		if (params.has(field)) {
			params.set(field, REDACTED);
		}
	}
	return params.toString();
}

/** Blank `sessionId` on a parsed auth response body, leaving everything else (userId, vaultIds, ...) intact. */
function redactAuthResponseSessionId(body: unknown): unknown {
	if (body === null || typeof body !== 'object' || !('sessionId' in body)) {
		return body;
	}
	return { ...(body as Record<string, unknown>), sessionId: REDACTED };
}

function pathOf(url: string): string {
	return tryParseUrl(url)?.pathname ?? url;
}

/** Parse an absolute URL, or `null` when the string isn't one (e.g. an already-relative path). */
function tryParseUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return String(value);
	}
}
