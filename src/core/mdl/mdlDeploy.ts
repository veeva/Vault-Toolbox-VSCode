import type { ApiHistoryEntry } from '../rest/apiHistory';
import type { MdlExecuteResult, MdlScriptExecution, MdlStatementResult } from '../rest/types';

/**
 * Pure outcome logic for the MDL Execute ("Deploy to Vault") operation, kept vscode-free so the
 * success classification and the toast headline are unit-testable in isolation; the extension command
 * is a thin adapter over these two functions (see ADR 0005).
 */

/** Vault's `script_execution.message` sentinel meaning "nothing to report"; omitted from the headline. */
const NO_SCRIPT_MESSAGE = 'OK';

/** Vault status token (statement `response` and envelope `responseStatus`) meaning it succeeded. */
const STATUS_SUCCESS = 'SUCCESS';
/** Envelope `responseStatus` meaning the deploy succeeded but emitted warnings. */
const STATUS_WARNING = 'WARNING';

/** A deploy outcome for display: whether it succeeded and a single-line notification headline. */
export interface MdlDeployOutcome {
	ok: boolean;
	/**
	 * A single-line summary for the notification toast. Leads with the failure detail (not the
	 * metadata) and suppresses zero-valued counts, so the one thing that matters on a failure is the
	 * first thing read. The full request/response is one click away via **View API Call**.
	 */
	headline: string;
}

/**
 * Whether an MDL Execute result is a clean success. Success requires a `SUCCESS`/`WARNING` envelope
 * **and** zero failures **and** zero exceptions **and** every statement's `response` being `SUCCESS`
 * — so a green envelope hiding statement-level errors reads as a failure. Missing counts are treated
 * as zero. Warnings alone (no failures/exceptions) still count as success.
 */
export function isMdlDeploySuccess(result: MdlExecuteResult): boolean {
	const envelopeOk =
		result.responseStatus === STATUS_SUCCESS || result.responseStatus === STATUS_WARNING;
	const failures = result.scriptExecution?.failures ?? 0;
	const exceptions = result.scriptExecution?.exceptions ?? 0;
	const statementsOk = result.statements.every(
		(statement) => statement.response === STATUS_SUCCESS,
	);
	return envelopeOk && failures === 0 && exceptions === 0 && statementsOk;
}

/**
 * Turn an MDL Execute result into a `{ ok, headline }` outcome for the notification toast: a
 * success/failure title, the salient error message(s) on a failure, and the non-zero
 * `script_execution` counts. The full detail (per-statement results, target DNS, execution time)
 * lives in the API History entry reachable from the toast's **View API Call** button.
 */
export function summarizeMdlDeploy(result: MdlExecuteResult): MdlDeployOutcome {
	const ok = isMdlDeploySuccess(result);
	const title = ok ? 'Deploy to Vault succeeded' : 'Deploy to Vault failed';
	return { ok, headline: formatHeadline(result, ok, title) };
}

/**
 * The toast summary: `title — <salient error(s)> · <non-zero counts>`. On a failure the error
 * message(s) come first so the reader isn't scanning past zeroed counts to reach what actually went
 * wrong. The target DNS and execution time are left to the API History entry (View API Call).
 */
function formatHeadline(result: MdlExecuteResult, ok: boolean, title: string): string {
	const parts = ok ? [] : salientErrorMessages(result);
	const counts = formatNonZeroCounts(result.scriptExecution, ok);
	if (counts) {
		parts.push(counts);
	}
	return parts.length > 0 ? `${title} — ${parts.join(' · ')}` : title;
}

/** The failure messages worth leading with, de-duplicated: script message, then failing statements, then envelope errors. */
function salientErrorMessages(result: MdlExecuteResult): string[] {
	const messages: string[] = [];
	const scriptMessage = result.scriptExecution?.message;
	if (scriptMessage && scriptMessage !== NO_SCRIPT_MESSAGE) {
		messages.push(scriptMessage);
	}
	for (const statement of result.statements) {
		if (statement.response !== STATUS_SUCCESS) {
			messages.push(formatStatement(statement));
		}
	}
	for (const error of result.errors ?? []) {
		messages.push(error.message);
	}
	return [...new Set(messages)];
}

/**
 * The counts worth showing on one line: on a failure, only the non-zero ones (so `Failures: 1` isn't
 * buried under three zeros); on a success, `Components affected` always. Empty when nothing is worth
 * saying.
 */
function formatNonZeroCounts(script: MdlScriptExecution | undefined, ok: boolean): string {
	if (!script) {
		return '';
	}
	const counts: string[] = [];
	const componentsAffected = script.componentsAffected ?? 0;
	if (ok || componentsAffected > 0) {
		counts.push(`Components affected: ${componentsAffected}`);
	}
	if ((script.warnings ?? 0) > 0) {
		counts.push(`Warnings: ${script.warnings}`);
	}
	if ((script.failures ?? 0) > 0) {
		counts.push(`Failures: ${script.failures}`);
	}
	if ((script.exceptions ?? 0) > 0) {
		counts.push(`Exceptions: ${script.exceptions}`);
	}
	return counts.join(' · ');
}

/** The version-less MDL Execute endpoint every "Deploy to Vault" POSTs to (see ADR 0005). */
const MDL_EXECUTE_PATH = '/api/mdl/execute';

/** True when an API History entry is an MDL Execute call (the request a "Deploy to Vault" makes). */
export function isMdlExecuteCall(entry: ApiHistoryEntry): boolean {
	return entry.method === 'POST' && entry.url.endsWith(MDL_EXECUTE_PATH);
}

/** One statement's line: Vault's own message, or a composed `Statement N: RESPONSE` fallback. */
function formatStatement(statement: MdlStatementResult): string {
	return (
		statement.message ??
		`Statement ${statement.statement ?? '?'}: ${statement.response ?? 'UNKNOWN'}`
	);
}
