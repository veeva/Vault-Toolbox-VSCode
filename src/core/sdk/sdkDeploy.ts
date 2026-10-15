import type { ApiHistoryEntry } from '../rest/apiHistory';
import type { SdkCodeResult } from '../rest/types';

/**
 * Pure outcome logic for the "Deploy to Vault" operation on a `.java` file (**Deploy Java SDK Code**),
 * kept vscode-free so the success classification and the notification headline are unit-testable in
 * isolation. The extension command is a thin adapter over these functions, mirroring `core/mdl`'s
 * `mdlDeploy` (see ADR 0005).
 */

/** Envelope `responseStatus` meaning an SDK-code operation (deploy or delete) succeeded. */
export const STATUS_SUCCESS = 'SUCCESS';

/** A deploy/delete outcome for display: whether it succeeded and a single-line notification headline. */
export interface SdkCodeOutcome {
	ok: boolean;
	headline: string;
}

/** Whether a `/code` deploy result is a success — a `SUCCESS` envelope (FAILURE-on-2xx reads as failure). */
export function isSdkDeploySuccess(result: SdkCodeResult): boolean {
	return result.responseStatus === STATUS_SUCCESS;
}

/**
 * Turn a deploy result into a `{ ok, headline }` outcome for the notification toast. On success the
 * headline surfaces the fully-qualified class name Vault recorded (`url`), so the developer can confirm
 * exactly what was written; on failure it leads with Vault's own error message. The full request and
 * raw response are one click away via **View API Call**.
 */
export function summarizeSdkDeploy(result: SdkCodeResult): SdkCodeOutcome {
	const ok = isSdkDeploySuccess(result);
	if (ok) {
		const title = 'Deploy to Vault succeeded';
		return { ok, headline: result.url ? `${title} — ${result.url}` : title };
	}
	const detail = sdkErrorDetail(result);
	const title = 'Deploy to Vault failed';
	return { ok, headline: detail ? `${title} — ${detail}` : title };
}

/**
 * The salient failure message from a `/code` FAILURE envelope: the first structured error, else the
 * envelope `responseMessage`. Shared by the deploy and delete summaries.
 */
export function sdkErrorDetail(result: SdkCodeResult): string | undefined {
	return result.errors?.[0]?.message ?? result.responseMessage;
}

/** The versioned SDK-code deploy endpoint a "Deploy to Vault" PUTs to (`/api/{version}/code`). */
export function isSdkDeployCall(entry: ApiHistoryEntry): boolean {
	return entry.method === 'PUT' && entry.url.endsWith('/code');
}
