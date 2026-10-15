import { isMdlExecuteCall, summarizeMdlDeploy } from '../../core/mdl/mdlDeploy';
import type { MdlExecuteResult } from '../../core/rest/types';
import { type ApiCallReportDeps, runAndReportApiCall } from '../apiHistory/apiCallReport';

/**
 * The MDL Execute binding over the shared {@link runAndReportApiCall} plumbing: it pins the
 * `POST /api/mdl/execute` call shape and the `summarizeMdlDeploy` headline so MDL callers don't
 * repeat them. The generic run-under-progress-and-report-with-deep-link logic lives in
 * `apiCallReport`, shared with the SDK-code commands.
 */

/** The API History deep-link seam an MDL Execute outcome toast needs from the host. */
export type OutcomeToastDeps = ApiCallReportDeps;

/**
 * Run one MDL Execute under a progress notification and report its outcome as a non-modal toast with
 * a **View API Call** deep-link, returning whether it succeeded. Shared by "Deploy to Vault", MDL
 * drop, and Compare's one-way apply, which differ only in the progress title and how they phrase a
 * failure — everything decision-worthy stays in `summarizeMdlDeploy`.
 */
export async function runAndReportMdlExecute(
	deps: OutcomeToastDeps,
	options: {
		progressTitle: string;
		failurePrefix: string;
		execute: () => Promise<MdlExecuteResult>;
	},
): Promise<boolean> {
	return runAndReportApiCall(deps, {
		progressTitle: options.progressTitle,
		failurePrefix: options.failurePrefix,
		isCall: isMdlExecuteCall,
		summarize: summarizeMdlDeploy,
		execute: options.execute,
	});
}
