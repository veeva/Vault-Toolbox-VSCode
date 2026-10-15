import { describe, it, expect } from 'vitest';
import { encodeMultipartFormData } from './multipart';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('encodeMultipartFormData', () => {
	it('builds a multipart/form-data content-type carrying the generated boundary', () => {
		const { contentType } = encodeMultipartFormData([
			{ name: 'file', filename: 'HelloWorld.java', data: new TextEncoder().encode('x') },
		]);
		const match = /^multipart\/form-data; boundary=(.+)$/.exec(contentType);
		expect(match).not.toBeNull();
		expect(match?.[1]?.length).toBeGreaterThan(0);
	});

	it('carries the file field with its name, filename, and verbatim bytes between boundary markers', () => {
		const source = 'package com.veeva.vault.custom.triggers;\nclass HelloWorld {}\n';
		const { contentType, body } = encodeMultipartFormData([
			{ name: 'file', filename: 'HelloWorld.java', data: new TextEncoder().encode(source) },
		]);
		const boundary = /boundary=(.+)$/.exec(contentType)?.[1] as string;
		const text = decode(body);

		expect(text).toContain(`--${boundary}\r\n`);
		expect(text).toContain(
			'Content-Disposition: form-data; name="file"; filename="HelloWorld.java"',
		);
		expect(text).toContain(source);
		// Closing boundary marker with the trailing dashes.
		expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
	});

	it('defaults a part content-type to application/octet-stream and honors an override', () => {
		const defaulted = encodeMultipartFormData([
			{ name: 'file', filename: 'a.java', data: new Uint8Array() },
		]);
		expect(decode(defaulted.body)).toContain('Content-Type: application/octet-stream');

		const overridden = encodeMultipartFormData([
			{ name: 'file', filename: 'a.java', data: new Uint8Array(), contentType: 'text/x-java' },
		]);
		expect(decode(overridden.body)).toContain('Content-Type: text/x-java');
	});

	it('preserves non-ASCII source bytes exactly (UTF-8 round-trip)', () => {
		const source = 'class Café {}';
		const encoded = new TextEncoder().encode(source);
		const { body } = encodeMultipartFormData([
			{ name: 'file', filename: 'Café.java', data: encoded },
		]);
		expect(decode(body)).toContain(source);
	});
});
