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
		showInformationMessage: vi.fn(),
	},
	workspace: {
		textDocuments: [] as unknown[],
		fs: { readFile: vi.fn() },
	},
}));

import * as vscode from 'vscode';
import { deploySdkCodeToVault, type DeploySdkCodeDeps } from './deploySdkCode';

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

function makeDeps(over: {
	state?: ConnectionState;
	result?: SdkCodeResult;
	runImpl?: (fn: (client: unknown) => Promise<unknown>) => Promise<unknown>;
}) {
	const addOrReplaceSourceCode = vi
		.fn()
		.mockResolvedValue(over.result ?? { responseStatus: 'SUCCESS', url: 'com.a.Hello' });
	const client = { sdk: { addOrReplaceSourceCode } };
	const run = vi.fn(
		over.runImpl ?? ((fn: (c: unknown) => Promise<unknown>) => fn(client)),
	);
	const deps: DeploySdkCodeDeps = {
		connection: {
			getState: () => over.state ?? connectedState(),
			run: run as never,
		},
		apiHistory: { snapshot: () => [] },
		revealApiHistoryEntry: vi.fn(),
	};
	return { deps, run, addOrReplaceSourceCode };
}

const bytes = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
	vi.clearAllMocks();
	(vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
	(vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
});

describe('deploySdkCodeToVault', () => {
	it('asks the user to select a .java file when no resource and no active editor', async () => {
		const { deps, run } = makeDeps({});

		await deploySdkCodeToVault(deps, undefined);

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'Open or select a .java file to deploy.',
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('refuses when no Vault is connected', async () => {
		const { deps, run } = makeDeps({ state: { status: 'disconnected' } });

		await deploySdkCodeToVault(deps, uri('/src/Hello.java'));

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'Connect to a Vault before deploying SDK code.',
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('blocks deploy on a Production Vault with a modal', async () => {
		const prod = {
			status: 'connected',
			info: {
				environment: { vaultDNS: 'prod.veevavault.com' },
				apiVersion: 'v26.2',
				domain: { domainType: 'PRODUCTION' },
			},
		} as unknown as ConnectionState;
		const { deps, run } = makeDeps({ state: prod });

		await deploySdkCodeToVault(deps, uri('/src/Hello.java'));

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'Deploy to Vault is blocked on a Production Vault.',
			expect.objectContaining({ modal: true }),
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('aborts a whitespace-only file locally without contacting Vault', async () => {
		const { deps, run } = makeDeps({});
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes('   \n\t'));

		await deploySdkCodeToVault(deps, uri('/src/Empty.java'));

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			'This .java file is empty or contains only whitespace; there is nothing to deploy.',
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('uploads the saved-then-read bytes and reports success', async () => {
		const { deps, run, addOrReplaceSourceCode } = makeDeps({
			result: { responseStatus: 'SUCCESS', url: 'com.a.Hello' },
		});
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(bytes('public class Hello {}'));

		await deploySdkCodeToVault(deps, uri('/src/Hello.java'));

		expect(run).toHaveBeenCalledOnce();
		expect(addOrReplaceSourceCode).toHaveBeenCalledWith(
			'Hello.java',
			expect.any(Uint8Array),
			'toolbox-actions-sdk',
		);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			'Deploy to Vault succeeded — com.a.Hello',
		);
	});
});
