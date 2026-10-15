import { describe, it, expect, vi, beforeEach } from 'vitest';

// sdkFile reaches into the vscode workspace for open documents and on-disk bytes; stub that surface.
vi.mock('vscode', () => ({
	workspace: {
		textDocuments: [] as unknown[],
		fs: { readFile: vi.fn() },
	},
}));

import * as vscode from 'vscode';
import { baseName, readFileText, saveThenReadFileBytes } from './sdkFile';

/** A minimal vscode.Uri: only `.path` and `.toString()` are used by sdkFile. */
function uri(path: string): vscode.Uri {
	return { path, toString: () => `file://${path}` } as unknown as vscode.Uri;
}

/** A minimal open text document with a save spy. */
function openDoc(path: string, opts: { text: string; isDirty: boolean }) {
	const save = vi.fn().mockResolvedValue(true);
	const doc = {
		uri: uri(path),
		isDirty: opts.isDirty,
		getText: () => opts.text,
		save,
	};
	return { doc, save };
}

function setOpenDocs(...docs: unknown[]): void {
	(vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = docs;
}

const bytes = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
	vi.clearAllMocks();
	setOpenDocs();
});

describe('baseName', () => {
	it('returns the final path segment', () => {
		expect(baseName(uri('/a/b/HelloWorld.java'))).toBe('HelloWorld.java');
	});

	it('returns the whole path when there is no slash', () => {
		expect(baseName(uri('HelloWorld.java'))).toBe('HelloWorld.java');
	});
});

describe('saveThenReadFileBytes', () => {
	it('saves a dirty open document first, then returns the on-disk bytes and basename', async () => {
		const target = uri('/src/HelloWorld.java');
		const { doc, save } = openDoc('/src/HelloWorld.java', { text: 'live', isDirty: true });
		setOpenDocs(doc);
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes('on-disk'));

		const result = await saveThenReadFileBytes(target);

		expect(save).toHaveBeenCalledOnce();
		expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(target);
		expect(result.fileName).toBe('HelloWorld.java');
		expect(new TextDecoder().decode(result.bytes)).toBe('on-disk');
	});

	it('does not save a clean open document', async () => {
		const target = uri('/src/HelloWorld.java');
		const { doc, save } = openDoc('/src/HelloWorld.java', { text: 'x', isDirty: false });
		setOpenDocs(doc);
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes('x'));

		await saveThenReadFileBytes(target);

		expect(save).not.toHaveBeenCalled();
	});

	it('reads from disk when the file is not open in any editor', async () => {
		const target = uri('/src/HelloWorld.java');
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes('on-disk'));

		const result = await saveThenReadFileBytes(target);

		expect(new TextDecoder().decode(result.bytes)).toBe('on-disk');
	});
});

describe('readFileText', () => {
	it('uses the live in-editor text of an open dirty document without saving', async () => {
		const target = uri('/src/HelloWorld.java');
		const { doc, save } = openDoc('/src/HelloWorld.java', { text: 'unsaved edits', isDirty: true });
		setOpenDocs(doc);

		const result = await readFileText(target);

		expect(result).toEqual({ fileName: 'HelloWorld.java', text: 'unsaved edits' });
		expect(save).not.toHaveBeenCalled();
		expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
	});

	it('reads and decodes the on-disk bytes when the file is not open', async () => {
		const target = uri('/src/HelloWorld.java');
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes('package com.a;'));

		const result = await readFileText(target);

		expect(result).toEqual({ fileName: 'HelloWorld.java', text: 'package com.a;' });
	});
});
