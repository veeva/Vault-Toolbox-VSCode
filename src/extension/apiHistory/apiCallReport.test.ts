import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiHistoryEntry } from '../../core/rest/apiHistory';

// runAndReportApiCall drives real vscode notifications; stub the surface it touches so the module
// loads and reports in the node test env (same pattern as shellHost.test.ts).
vi.mock('vscode', () => ({
	ProgressLocation: { Notification: 15 },
	window: {
		withProgress: vi.fn((_opts: unknown, task: () => unknown) => task()),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
}));

import * as vscode from 'vscode';
import { runAndReportApiCall, type ApiCallReportDeps } from './apiCallReport';

const VIEW = 'View API Call';

const entry = (over: Partial<ApiHistoryEntry>): ApiHistoryEntry =>
	({ id: 'x', method: 'PUT', url: '/api/v26.2/code', ...over }) as ApiHistoryEntry;

/** The call shape under test: a PUT (deploy-like); GETs are unrelated traffic. */
const isCall = (e: ApiHistoryEntry) => e.method === 'PUT';

/**
 * A deps whose snapshot reflects a mutable, newest-first log, plus the reveal spy. `execute` in each
 * test unshifts the entry the call "made" so the before/after snapshots differ, exactly as the real
 * API History log behaves.
 */
function makeDeps(log: ApiHistoryEntry[]) {
	const revealApiHistoryEntry = vi.fn();
	const deps: ApiCallReportDeps = {
		apiHistory: { snapshot: () => [...log] },
		revealApiHistoryEntry,
	};
	return { deps, revealApiHistoryEntry };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('runAndReportApiCall', () => {
	it('reports success as an info toast, offers View API Call, and reveals the new entry on click', async () => {
		const log = [entry({ id: 'old' })];
		const { deps, revealApiHistoryEntry } = makeDeps(log);
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(VIEW as never);

		const ok = await runAndReportApiCall(deps, {
			progressTitle: 'Deploying…',
			failurePrefix: 'Deploy failed:',
			isCall,
			summarize: () => ({ ok: true, headline: 'Deploy succeeded' }),
			execute: async () => {
				log.unshift(entry({ id: 'new' }));
				return 'result';
			},
		});

		expect(ok).toBe(true);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Deploy succeeded', VIEW);
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		expect(revealApiHistoryEntry).toHaveBeenCalledWith('new');
	});

	it('reports a summarized failure as an error toast and returns false', async () => {
		const log = [entry({ id: 'old' })];
		const { deps } = makeDeps(log);
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined as never);

		const ok = await runAndReportApiCall(deps, {
			progressTitle: 'Deploying…',
			failurePrefix: 'Deploy failed:',
			isCall,
			summarize: () => ({ ok: false, headline: 'Deploy failed — bad package' }),
			execute: async () => {
				log.unshift(entry({ id: 'new' }));
				return 'result';
			},
		});

		expect(ok).toBe(false);
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Deploy failed — bad package', VIEW);
	});

	it('picks the newest matching entry when a session-recovery retry produced two', async () => {
		const log = [entry({ id: 'old' })];
		const { deps, revealApiHistoryEntry } = makeDeps(log);
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(VIEW as never);

		await runAndReportApiCall(deps, {
			progressTitle: 't',
			failurePrefix: 'f:',
			isCall,
			summarize: () => ({ ok: true, headline: 'ok' }),
			execute: async () => {
				// Newest-first log: the first try is recorded, then the retry is prepended on top of
				// it — so the retry sits at index 0 and is the one to deep-link.
				log.unshift(entry({ id: 'first-try' }));
				log.unshift(entry({ id: 'retry' }));
				return 'r';
			},
		});

		expect(revealApiHistoryEntry).toHaveBeenCalledWith('retry');
	});

	it('omits the button (and never reveals) when no new matching entry is found', async () => {
		const log = [entry({ id: 'old' })];
		const { deps, revealApiHistoryEntry } = makeDeps(log);
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as never);

		await runAndReportApiCall(deps, {
			progressTitle: 't',
			failurePrefix: 'f:',
			isCall,
			summarize: () => ({ ok: true, headline: 'ok' }),
			execute: async () => 'r', // recording produced no new entry
		});

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('ok');
		expect(revealApiHistoryEntry).not.toHaveBeenCalled();
	});

	it('does not reveal when the toast is dismissed without clicking View API Call', async () => {
		const log = [entry({ id: 'old' })];
		const { deps, revealApiHistoryEntry } = makeDeps(log);
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as never);

		await runAndReportApiCall(deps, {
			progressTitle: 't',
			failurePrefix: 'f:',
			isCall,
			summarize: () => ({ ok: true, headline: 'ok' }),
			execute: async () => {
				log.unshift(entry({ id: 'new' }));
				return 'r';
			},
		});

		expect(revealApiHistoryEntry).not.toHaveBeenCalled();
	});

	it('reports a thrown error as an error toast prefixed with failurePrefix and returns false', async () => {
		const log: ApiHistoryEntry[] = [];
		const { deps } = makeDeps(log);
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined as never);

		const ok = await runAndReportApiCall(deps, {
			progressTitle: 't',
			failurePrefix: 'Deploy failed:',
			isCall,
			summarize: () => ({ ok: true, headline: 'unused' }),
			execute: async () => {
				throw new Error('network down');
			},
		});

		expect(ok).toBe(false);
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Deploy failed: network down');
	});
});
