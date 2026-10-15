/**
 * Minimal `multipart/form-data` body builder for the transport layer. Existing Vault calls send JSON,
 * form-urlencoded, or binary bodies; the "Deploy Java SDK Code" PUT (`/code`) is the first that needs
 * multipart — the `.java` source is uploaded as a `file` field. Kept transport-free and byte-accurate
 * (assembling raw bytes rather than a `FormData`) so the boundary and headers are unit-testable and so
 * the transport can hand the assembled bytes straight to `fetch`.
 */

/** One file part of a multipart body: the form field name, the filename Vault records, and raw bytes. */
export interface MultipartFilePart {
	name: string;
	filename: string;
	data: Uint8Array;
	/** The part's `Content-Type`; defaults to `application/octet-stream`. */
	contentType?: string;
}

/** An assembled multipart body: the `Content-Type` header (carrying the boundary) and the byte body. */
export interface MultipartBody {
	contentType: string;
	body: Uint8Array;
}

const DEFAULT_PART_CONTENT_TYPE = 'application/octet-stream';

/**
 * Encode file parts as a `multipart/form-data` body. Returns the exact `Content-Type` header to send —
 * with the generated boundary — alongside the assembled bytes. The boundary carries a random token so
 * it cannot collide with a part's contents.
 */
export function encodeMultipartFormData(parts: MultipartFilePart[]): MultipartBody {
	const boundary = `----VaultToolboxBoundary${randomToken()}`;
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	for (const part of parts) {
		const header =
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
			`Content-Type: ${part.contentType ?? DEFAULT_PART_CONTENT_TYPE}\r\n\r\n`;
		chunks.push(encoder.encode(header), part.data, encoder.encode('\r\n'));
	}
	chunks.push(encoder.encode(`--${boundary}--\r\n`));
	return {
		contentType: `multipart/form-data; boundary=${boundary}`,
		body: concatBytes(chunks),
	};
}

/** A short, collision-resistant token for the multipart boundary (not security-sensitive). */
function randomToken(): string {
	return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Concatenate byte chunks into one contiguous `Uint8Array`. */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}
