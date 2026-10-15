import { VaultApiError } from './errors';
import type { HttpRequest, HttpTransport, VaultHttpResponse } from './types';

/** Cap on error-body text carried into a diagnostic message, to avoid ballooning on HTML pages. */
const MAX_ERROR_BODY_CHARS = 500;

/**
 * Real transport over Node's global `fetch`. When `timeoutMs` is given, an AbortController aborts the
 * request after that deadline; when omitted, the request waits for Vault to respond on its own (we
 * only fail-fast the connect handshake, not steady-state calls). It uses whatever proxy/TLS the
 * runtime already applies to `fetch`; the transport itself stays dependency-free and
 * framework-agnostic.
 */
export class NodeHttpTransport implements HttpTransport {
	async send(req: HttpRequest, timeoutMs?: number): Promise<VaultHttpResponse> {
		const controller = new AbortController();
		const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(req.url, {
				method: req.method,
				headers: req.headers,
				// `fetch` accepts a `Uint8Array` body at runtime (it's a valid `BodyInit`), but the DOM
				// lib types model `BodyInit` more narrowly than our request-body union; cast to bridge.
				body: req.body as RequestInit['body'],
				signal: controller.signal,
			});

			let body: unknown;
			if (req.responseType === 'binary' && res.ok) {
				// Artifact download: keep the raw bytes. Errors fall through to JSON decoding below so a
				// failure envelope (e.g. an expired session) still surfaces to the caller.
				body = new Uint8Array(await res.arrayBuffer());
			} else {
				const text = await res.text();
				try {
					body = text ? JSON.parse(text) : {};
				} catch {
					// Non-JSON (e.g. an HTML error page) — surface it in the Vault failure envelope shape.
					body = {
						responseStatus: 'FAILURE',
						errors: [{ type: 'NON_JSON_RESPONSE', message: text.slice(0, MAX_ERROR_BODY_CHARS) }],
					};
				}
			}

			const headers: Record<string, string> = {};
			res.headers.forEach((headerValue, headerName) => {
				headers[headerName] = headerValue;
			});

			return {
				status: res.status,
				getHeader: (name) => headers[name.toLowerCase()],
				headers,
				body,
			};
		} catch (error) {
			// Wrap transport faults in a VaultApiError so callers get a Vault-shaped failure and can
			// tell a timeout apart from other network errors, rather than an opaque raw AbortError.
			if (controller.signal.aborted) {
				throw new VaultApiError(`Request timed out after ${timeoutMs}ms`, 'TIMEOUT');
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new VaultApiError(`Network request failed: ${message}`, 'NETWORK_ERROR');
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		}
	}
}
