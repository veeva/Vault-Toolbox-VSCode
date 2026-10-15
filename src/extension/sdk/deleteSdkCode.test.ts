import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SdkCodeResult } from '../../core/rest/types';
import type { ConnectionState } from '../connection/types';

// The command is a thin vscode adapter; stub the notification/workspace/editor surface it wires.
vi.mock('vscode', () => ({
	ProgressLocation: { Notification: 15 },
	window: {
		activeTextEditor: undefined as unknown,
		withProgress: vi.fn((_opts: unknown, task: () => unknown) => task()),
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	workspace: {
		textDocuments: [] as unknown[],
		fs: { readFile: vi.fn() },
	},
}));

import * as vscode from 'vscode';
import { deleteSdkCodeFromVault, type DeleteSdkCodeDeps } from './deleteSdkCode';

function uri(path: string): vscode.Uri {
	return { path, toString: () => `file://${path}` } as unknown as vscode.Uri;
}

/** A connected, non-Production sandbox state. */
function connectedState(): ConnectionState {
	return {
		status: 'connected',
		info: {
			environment: { vaultDNS: 'my-sandbox.veevavault.com' },
			apiVersion: 'v26.2',
			domain: { domainType: 'sandbox' },
		},
	} as unknown as ConnectionState;
}

function makeDeps(over: { state?: ConnectionState; result?: SdkCodeResult }) {
	const deleteSourceCode = vi
		.fn()
		.mockResolvedValue(over.result ?? { responseStatus: 'SUCCESS' });
	const client = { sdk: { deleteSourceCode } };
	const run = vi.fn((fn: (c: unknown) => Promise<unknown>) => fn(client));
	const deps: DeleteSdkCodeDeps = {
		connection: {
			getState: () => over.state ?? connectedState(),
			run: run as never,
		},
		apiHistory: { snapshot: () => [] },
		revealApiHistoryEntry: vi.fn(),
	};
	return { deps, run, deleteSourceCode };
}

const bytes = (s: string) => new TextEncoder().encode(s);

/** A well-formed source file whose FQCN derives to `com.veeva.vault.custom.Hello`. */
function validSource(): void {
	vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes('package com.veeva.vault.custom;'));
}

beforeEach(() => {
	vi.clearAllMocks();
	(vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
	(vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
});

describe('deleteSdkCodeFromVault', () => {
	it('asks the user to select a .java file when no resource and no active editor', async () => {
		const { deps, run } = makeDeps({});

		await deleteSdkCodeFromVault(deps, undefined);

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'Open or select a .java file to delete.',
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('refuses when no Vault is connected', async () => {
		const { deps, run } = makeDeps({ state: { status: 'disconnected' } });

		await deleteSdkCodeFromVault(deps, uri('/src/Hello.java'));

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'Connect to a Vault before deleting SDK code.',
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('blocks delete on a Production Vault with a modal', async () => {
		const prod = {
			status: 'connected',
			info: {
				environment: { vaultDNS: 'prod.veevavault.com' },
				apiVersion: 'v26.2',
				domain: { domainType: 'PRODUCTION' },
			},
		} as unknown as ConnectionState;
		const { deps, run } = makeDeps({ state: prod });

		await deleteSdkCodeFromVault(deps, uri('/src/Hello.java'));

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'Delete from Vault is blocked on a Production Vault.',
			expect.objectContaining({ modal: true }),
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('aborts with the derivation error and sends nothing when the FQCN cannot be built', async () => {
		const { deps, run } = makeDeps({});
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes('public class Hello {}')); // no package

		await deleteSdkCodeFromVault(deps, uri('/src/Hello.java'));

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining('no `package` declaration'),
		);
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
	});

	it('does not delete when the confirmation modal is dismissed', async () => {
		const { deps, run } = makeDeps({});
		validSource();
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as never);

		await deleteSdkCodeFromVault(deps, uri('/src/Hello.java'));

		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			expect.stringContaining('Delete this Vault Java SDK class'),
			expect.objectContaining({ modal: true, detail: 'com.veeva.vault.custom.Hello' }),
			'Delete',
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('deletes the derived class and reports success once confirmed', async () => {
		const { deps, run, deleteSourceCode } = makeDeps({ result: { responseStatus: 'SUCCESS' } });
		validSource();
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Delete' as never);

		await deleteSdkCodeFromVault(deps, uri('/src/Hello.java'));

		expect(run).toHaveBeenCalledOnce();
		expect(deleteSourceCode).toHaveBeenCalledWith(
			'com.veeva.vault.custom.Hello',
			'toolbox-actions-sdk',
		);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Delete from Vault succeeded');
	});
});
