/**
 * Pure apply-execution core for **Compare Environments** (see CONTEXT.md, ADR 0006). Owns the
 * decision-worthy *how* of a one-way apply once the controller's gates (apply-enabled opt-in, live
 * Production block, confirmation) have passed: dispatching an {@link ApplyPlan} to the right target
 * write, deciding success, and recomputing the entry's status honestly from a re-read. Kept
 * `vscode`-free and driven by a narrow {@link CompareApplyPort} so every operation is unit-testable
 * with a fake port — the controller is a thin adapter that builds the port over its target connection,
 * wraps the write in the shared outcome-toast plumbing, and applies the result to the session.
 *
 * This replaces the three near-identical operation→write dispatches (single MDL, single code, batch)
 * and the two recompute paths (MDL/code) that previously lived inline in `compareController.ts`.
 */

import type { ApiHistoryEntry } from '../rest/apiHistory';
import type { MdlExecuteResult, SdkCodeResult } from '../rest/types';
import { isMdlExecuteCall, summarizeMdlDeploy } from '../mdl/mdlDeploy';
import { isSdkDeployCall, summarizeSdkDeploy } from '../sdk/sdkDeploy';
import { isSdkDeleteCall, summarizeSdkDelete } from '../sdk/sdkDelete';
import { simpleClassName } from '../sdk/sdkExtraction';
import {
	deriveApplyPlan,
	statusAfterReread,
	type ApplyOperation,
	type ApplyPlan,
	type CompareEntry,
	type ComponentDefinition,
} from './compareComponents';

/**
 * The narrow slice of the **target** Vault connection an apply needs — writes (one-way, source →
 * target) plus the post-apply re-reads used to recompute status. Every method routes to the target
 * only; the controller satisfies it over `connection.run(targetEnvId, …)`. Mirrors the read-side
 * {@link import('./compareRun').CompareVaultPort}.
 */
export interface CompareApplyPort {
	/** Execute an MDL script against the target (create/update or `DROP`). */
	executeMdl(script: string): Promise<MdlExecuteResult>;
	/** PUT one custom Java SDK source file (**Deploy Java SDK Code**) — the multipart filename and bytes. */
	deploySource(fileName: string, bytes: Uint8Array): Promise<SdkCodeResult>;
	/** DELETE one custom Java SDK class by fully-qualified name (**Delete Java SDK Code**). */
	deleteSource(className: string): Promise<SdkCodeResult>;
	/** Re-read one component's MDL from the target (Component Definition Query); `undefined` if it's gone. */
	retrieveComponentDefinition(type: string, name: string): Promise<ComponentDefinition | undefined>;
	/** Re-read one class's source from the target; rejects when the source can't be retrieved. */
	retrieveSourceCode(className: string): Promise<string>;
}

/** The raw Vault result of an apply write — an MDL Execute envelope or an SDK-code envelope. */
export type ApplyWriteResult = MdlExecuteResult | SdkCodeResult;

/** An apply outcome for the toast: whether it succeeded and a single-line headline. Structurally the
 *  host's `ApiCallOutcome`, so a spec's {@link ApplyReportSpec.summarize} drops straight into it. */
export interface ApplyOutcome {
	ok: boolean;
	headline: string;
}

/**
 * The API-History deep-link metadata for one operation: which call shape to correlate (`isCall`) and
 * how to turn its result into a headline (`summarize`). Supplied to the host's outcome-toast plumbing
 * so the controller no longer branches per operation to pick them.
 */
export interface ApplyReportSpec {
	isCall: (entry: ApiHistoryEntry) => boolean;
	summarize: (result: ApplyWriteResult) => ApplyOutcome;
}

/**
 * The deep-link + headline spec for an operation. The `as` narrowings are safe by construction: the
 * operation determines which {@link CompareApplyPort} write produced the result and hence its shape
 * ({@link MdlExecuteResult} for `execute`/`drop`, {@link SdkCodeResult} for `deploy`/`delete`).
 */
export function reportSpecFor(operation: ApplyOperation): ApplyReportSpec {
	switch (operation) {
		case 'execute':
		case 'drop':
			return {
				isCall: isMdlExecuteCall,
				summarize: (result) => summarizeMdlDeploy(result as MdlExecuteResult),
			};
		case 'deploy':
			return {
				isCall: isSdkDeployCall,
				summarize: (result) => summarizeSdkDeploy(result as SdkCodeResult),
			};
		case 'delete':
			return {
				isCall: isSdkDeleteCall,
				summarize: (result) => summarizeSdkDelete(result as SdkCodeResult),
			};
	}
}

/** Whether an apply write succeeded, using the same per-operation summary the toast reports. */
export function isApplyWriteSuccess(operation: ApplyOperation, result: ApplyWriteResult): boolean {
	return reportSpecFor(operation).summarize(result).ok;
}

/**
 * Perform one apply write against the target, dispatching by the plan's operation: MDL `execute`/`drop`
 * via MDL Execute, code `deploy` via **Deploy Java SDK Code** (deriving the `.java` filename from the
 * class and encoding the source), code `delete` via **Delete Java SDK Code**. Returns the raw Vault
 * result; success classification is {@link isApplyWriteSuccess}. No gating here — the caller enforces
 * the apply-enabled opt-in, the live Production block, and confirmation first.
 */
export function applyWrite(plan: ApplyPlan, port: CompareApplyPort): Promise<ApplyWriteResult> {
	switch (plan.operation) {
		case 'execute':
		case 'drop':
			return port.executeMdl(plan.script);
		case 'deploy': {
			const fileName = `${simpleClassName(plan.className)}.java`;
			const bytes = new TextEncoder().encode(plan.source);
			return port.deploySource(fileName, bytes);
		}
		case 'delete':
			return port.deleteSource(plan.className);
	}
}

/**
 * What a post-apply re-read decided for an entry: replace it with a freshly-classified entry, remove it
 * (it now exists on neither side), or leave it unchanged (the write didn't alter its standing).
 */
export type RecomputeResult =
	| { kind: 'replace'; entry: CompareEntry }
	| { kind: 'remove' }
	| { kind: 'unchanged' };

/**
 * Recompute one entry's status after a successful apply by re-reading it from the target and
 * classifying by the same byte-equality the diff uses (see {@link statusAfterReread}) — so an entry
 * only reads Identical when the target genuinely matches (ADR 0006's honest post-apply state). A
 * dropped/deleted entry that's gone from the target is removed; an MDL re-read that still finds the
 * component (e.g. a `DROP` that didn't take, or a create/update) reclassifies it; a code re-read whose
 * source can't be fetched back classifies Unavailable. Collapses the old MDL/code recompute paths.
 */
export async function recomputeEntry(
	entry: CompareEntry,
	operation: ApplyOperation,
	port: CompareApplyPort,
): Promise<RecomputeResult> {
	if (operation === 'delete') {
		// A target-only class deleted from the target now exists on neither side.
		return { kind: 'remove' };
	}
	if (operation === 'drop') {
		const retrieved = await port.retrieveComponentDefinition(entry.type, entry.name);
		return retrieved ? { kind: 'unchanged' } : { kind: 'remove' };
	}
	if (operation === 'execute') {
		const retrieved = await port.retrieveComponentDefinition(entry.type, entry.name);
		if (!retrieved) {
			return { kind: 'unchanged' };
		}
		return {
			kind: 'replace',
			entry: {
				kind: 'mdl',
				type: entry.type,
				name: entry.name,
				status: statusAfterReread(entry.sourceMdl, retrieved.mdl),
				sourceMdl: entry.sourceMdl,
				targetMdl: retrieved.mdl,
			},
		};
	}
	// deploy: re-read the just-written source; Unavailable if it can't be read back.
	let targetSource: string | undefined;
	try {
		targetSource = await port.retrieveSourceCode(entry.name);
	} catch {
		targetSource = undefined;
	}
	return {
		kind: 'replace',
		entry: {
			kind: 'code',
			type: '',
			name: entry.name,
			status: statusAfterReread(entry.sourceMdl, targetSource),
			sourceMdl: entry.sourceMdl,
			targetMdl: targetSource,
		},
	};
}

/** One item in a batch apply: the entry to act on and the plan derived for it. */
export interface BatchItem {
	entry: CompareEntry;
	plan: ApplyPlan;
}

/**
 * Prepare entries for batch apply: derive each entry's plan, drop non-applicable entries, then sort
 * MDL before SDK code so object/field definitions land before code that may reference them (ADR 0006).
 */
export function prepareBatch(entries: CompareEntry[]): BatchItem[] {
	const withPlans = entries
		.map((entry) => ({ entry, plan: deriveApplyPlan(entry) }))
		.filter((item): item is BatchItem => item.plan !== null);
	return [
		...withPlans.filter(({ entry }) => entry.kind === 'mdl'),
		...withPlans.filter(({ entry }) => entry.kind === 'code'),
	];
}
