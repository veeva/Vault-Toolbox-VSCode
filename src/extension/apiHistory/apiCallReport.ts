import * as vscode from 'vscode';
import type { ApiHistoryEntry } from '../../core/rest/apiHistory';
import { errorMessage } from '../platform/errors';

/**
 * Shared "run one Vault API call under a progress toast, then report its outcome with a **View API
 * Call** deep-link" plumbing. Every host command that makes a single, correlatable API call reports
 * through here so success/failure and the underlying call surface identically across features
 * (MDL Execute, SDK-code deploy/delete). The per-operation specifics — which API History entry shape
 * to correlate (`isCall`) and how to turn a result into a headline (`summarize`) — are injected, so
 * everything decision-worthy stays in the caller's pure `core` logic.
 */

/** The notification button that deep-links an API call's result to its entry in the API History inspector. */
const VIEW_API_CALL = 'View API Call';

/** The API History deep-link seam an outcome toast needs from the host. */
export interface ApiCallReportDeps {
	/** The in-memory API History log, read to correlate this call's entry. */
	apiHistory: { snapshot(): ApiHistoryEntry[] };
	/** Reveal + expand the given API History entry in whichever surface is active. */
	revealApiHistoryEntry(id: string): void | Promise<void>;
}

/** An operation outcome for display: whether it succeeded and a single-line notification headline. */
export interface ApiCallOutcome {
	ok: boolean;
	headline: string;
}

/**
 * Run one Vault API call under a progress notification and report its outcome as a non-modal toast,
 * adding a **View API Call** button when this call's entry can be found in the API History log.
 * `isCall` identifies the operation's call shape; the prior matching-call ids are captured *before*
 * running so the toast deep-links to exactly the call this made, even when a session-recovery retry
 * produced two. Returns whether the operation succeeded. On a thrown error the failure toast leads
 * with `failurePrefix` and the error message.
 */
export async function runAndReportApiCall<TResult>(
	deps: ApiCallReportDeps,
	options: {
		progressTitle: string;
		failurePrefix: string;
		isCall: (entry: ApiHistoryEntry) => boolean;
		summarize: (result: TResult) => ApiCallOutcome;
		execute: () => Promise<TResult>;
	},
): Promise<boolean> {
	const priorIds = new Set(
		deps.apiHistory
			.snapshot()
			.filter(options.isCall)
			.map((entry) => entry.id),
	);
	try {
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: options.progressTitle },
			() => options.execute(),
		);
		const outcome = options.summarize(result);
		await showApiCallOutcome(deps, options.isCall, priorIds, outcome.ok, outcome.headline);
		return outcome.ok;
	} catch (error) {
		await showApiCallOutcome(
			deps,
			options.isCall,
			priorIds,
			false,
			`${options.failurePrefix} ${errorMessage(error)}`,
		);
		return false;
	}
}

/** Show the success/failure toast, offering **View API Call** when this call's entry is found. */
async function showApiCallOutcome(
	deps: ApiCallReportDeps,
	isCall: (entry: ApiHistoryEntry) => boolean,
	priorIds: ReadonlySet<string>,
	ok: boolean,
	message: string,
): Promise<void> {
	// The snapshot is newest-first, so the first matching entry not already present is the newest
	// call — the one this operation just made, even if a session-recovery retry produced two.
	const entryId = deps.apiHistory
		.snapshot()
		.find((entry) => isCall(entry) && !priorIds.has(entry.id))?.id;
	const buttons = entryId ? [VIEW_API_CALL] : [];
	const clicked = ok
		? await vscode.window.showInformationMessage(message, ...buttons)
		: await vscode.window.showErrorMessage(message, ...buttons);
	if (clicked === VIEW_API_CALL && entryId) {
		await deps.revealApiHistoryEntry(entryId);
	}
}
