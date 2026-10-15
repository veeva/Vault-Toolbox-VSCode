import { describe, it, expect } from 'vitest';
import type { ApiHistoryEntry } from '../rest/apiHistory';
import {
	deriveSdkClassName,
	isSdkDeleteCall,
	isSdkDeleteSuccess,
	summarizeSdkDelete,
} from './sdkDelete';

describe('deriveSdkClassName', () => {
	it('builds the FQCN from the package declaration and the filename', () => {
		const source = 'package com.veeva.vault.custom.triggers;\npublic class HelloWorld {}\n';

		expect(deriveSdkClassName(source, 'HelloWorld.java')).toEqual({
			ok: true,
			className: 'com.veeva.vault.custom.triggers.HelloWorld',
		});
	});

	it('tolerates leading blank lines, comments, and indentation before the package line', () => {
		const source = '// a header comment\n\n   package com.veeva.vault.custom.actions ;\nclass Foo {}';

		expect(deriveSdkClassName(source, 'Foo.java')).toMatchObject({
			ok: true,
			className: 'com.veeva.vault.custom.actions.Foo',
		});
	});

	it('is case-insensitive on the .java extension when stripping the class name', () => {
		const source = 'package com.veeva.vault.custom;\n';

		expect(deriveSdkClassName(source, 'Widget.JAVA')).toMatchObject({
			ok: true,
			className: 'com.veeva.vault.custom.Widget',
		});
	});

	it('fails with a specific message when the file is empty or whitespace-only', () => {
		const parse = deriveSdkClassName('   \n\t\n', 'HelloWorld.java');

		expect(parse.ok).toBe(false);
		expect(parse).toMatchObject({ error: expect.stringMatching(/empty or unreadable/) });
	});

	it('fails when there is no package declaration at all', () => {
		const parse = deriveSdkClassName('public class HelloWorld {}\n', 'HelloWorld.java');

		expect(parse.ok).toBe(false);
		expect(parse).toMatchObject({ error: expect.stringMatching(/no `package` declaration/) });
	});

	it('fails distinctly when a package keyword is present but unparseable', () => {
		const parse = deriveSdkClassName('package ;\npublic class HelloWorld {}\n', 'HelloWorld.java');

		expect(parse.ok).toBe(false);
		expect(parse).toMatchObject({
			error: expect.stringMatching(/Could not read the package name/),
		});
	});

	it('does not treat the word "package" mid-line as a declaration', () => {
		const parse = deriveSdkClassName('// this file has no package\nclass HelloWorld {}', 'HelloWorld.java');

		expect(parse.ok).toBe(false);
		expect(parse).toMatchObject({ error: expect.stringMatching(/no `package` declaration/) });
	});
});

describe('isSdkDeleteSuccess', () => {
	it('is true for a SUCCESS envelope', () => {
		expect(isSdkDeleteSuccess({ responseStatus: 'SUCCESS' })).toBe(true);
	});

	it('is false for a FAILURE envelope (including FAILURE-on-2xx)', () => {
		expect(isSdkDeleteSuccess({ responseStatus: 'FAILURE' })).toBe(false);
	});
});

describe('summarizeSdkDelete', () => {
	it('reports a plain success (the class was named in the confirmation modal)', () => {
		const outcome = summarizeSdkDelete({ responseStatus: 'SUCCESS' });

		expect(outcome).toEqual({ ok: true, headline: 'Delete from Vault succeeded' });
	});

	it("leads a failure with Vault's structured error message", () => {
		const outcome = summarizeSdkDelete({
			responseStatus: 'FAILURE',
			errors: [{ type: 'OPERATION_NOT_ALLOWED', message: 'Code component currently in use.' }],
		});

		expect(outcome.ok).toBe(false);
		expect(outcome.headline).toBe('Delete from Vault failed — Code component currently in use.');
	});

	it('falls back to responseMessage, then to a bare failure title', () => {
		expect(
			summarizeSdkDelete({ responseStatus: 'FAILURE', responseMessage: 'File not found.' }).headline,
		).toBe('Delete from Vault failed — File not found.');
		expect(summarizeSdkDelete({ responseStatus: 'FAILURE' }).headline).toBe(
			'Delete from Vault failed',
		);
	});
});

describe('isSdkDeleteCall', () => {
	const entry = (over: Partial<ApiHistoryEntry>): ApiHistoryEntry =>
		({
			method: 'DELETE',
			url: 'https://x.veevavault.com/api/v26.2/code/com.veeva.vault.custom.triggers.HelloWorld',
			...over,
		}) as ApiHistoryEntry;

	it('matches a DELETE to the class-scoped /code/{class} endpoint', () => {
		expect(isSdkDeleteCall(entry({}))).toBe(true);
	});

	it('does not match the deploy PUT to the bare /code endpoint or other methods', () => {
		expect(isSdkDeleteCall(entry({ method: 'PUT', url: 'https://x/api/v26.2/code' }))).toBe(false);
		expect(isSdkDeleteCall(entry({ method: 'GET' }))).toBe(false);
	});
});
