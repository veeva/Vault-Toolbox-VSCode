/**
 * Pure fetch-orchestration core for **Compare Environments** (see CONTEXT.md, ADR 0006/0010). Owns the
 * decision-worthy parts of building a comparison — the MDL pull, the custom-code name query, the N+1
 * source download with per-class partial-failure aggregation, and the partial-comparison summary —
 * behind one small interface driven by a narrow {@link CompareVaultPort} per Vault. Kept `vscode`-free
 * so the orchestration is unit-testable with a fake port; the controller is a thin adapter that builds
 * ports over its connections and renders the result.
 */

import { customClassDisplayName, type SdkDownloadFailure } from '../sdk/sdkExtraction';
import { errorMessage } from '../errorMessage';
import type { CodeClass, ComponentDefinition } from './compareComponents';

/**
 * The narrow slice of one Vault connection a comparison needs, by role (source or target). Each method
 * is a single logical Vault read; `isCancelled` is threaded into the paginated pulls so a long fetch can
 * be stopped between pages. The controller satisfies this over `connection.run(envId, …)`.
 */
export interface CompareVaultPort {
	/** The Vault's DNS, used only for progress messages. */
	readonly label: string;
	/** Every MDL component definition (Component Definition Query, paginated). */
	fetchComponentDefinitions(isCancelled: () => boolean): Promise<ComponentDefinition[]>;
	/** Every custom Vault Java SDK class's fully-qualified name (paginated name query). */
	queryCustomCodeNames(isCancelled: () => boolean): Promise<string[]>;
	/** One class's source via `GET /code/{className}`; rejects when the source can't be retrieved. */
	retrieveSourceCode(className: string): Promise<string>;
}

/** Which kinds to fetch; at least one is expected on (the caller enforces that before fetching). */
export interface CompareKindsToFetch {
	mdl: boolean;
	code: boolean;
}

/** Cancellation + progress hooks for a fetch run. */
export interface CompareFetchOptions {
	/** Polled between phases and between per-class downloads so the run can be cancelled promptly. */
	isCancelled: () => boolean;
	/** Called with each user-facing progress message (the vscode layer forwards it to `withProgress`). */
	onProgress?: (message: string) => void;
}

/** The code side of a fetch: each Vault's classes (with per-class source or failure) and the failures. */
export interface CodeFetchResult {
	source: CodeClass[];
	target: CodeClass[];
	failures: SdkDownloadFailure[];
}

/** The raw data a comparison was built from — whichever kinds were fetched. */
export interface CompareData {
	mdl?: { source: ComponentDefinition[]; target: ComponentDefinition[] };
	code?: CodeFetchResult;
}

/** A completed fetch, or a cancellation (nothing to commit — the caller keeps the prior comparison). */
export type FetchComparisonResult =
	| { kind: 'fetched'; data: CompareData }
	| { kind: 'cancelled' };

/**
 * Fetch both Vaults' data for the selected kinds: MDL first (a single paginated pull per Vault), then
 * code (name query per Vault, then the eager source download from both). Cancellation is honored between
 * phases; a cancel returns `cancelled` so the caller discards the partial pull and leaves the previous
 * comparison intact.
 */
export async function fetchComparison(
	source: CompareVaultPort,
	target: CompareVaultPort,
	kinds: CompareKindsToFetch,
	options: CompareFetchOptions,
): Promise<FetchComparisonResult> {
	const data: CompareData = {};

	if (kinds.mdl) {
		options.onProgress?.(`Pulling components from ${source.label}…`);
		const sourceComponents = await source.fetchComponentDefinitions(options.isCancelled);
		options.onProgress?.(`Pulling components from ${target.label}…`);
		const targetComponents = await target.fetchComponentDefinitions(options.isCancelled);
		data.mdl = { source: sourceComponents, target: targetComponents };
	}
	if (options.isCancelled()) {
		return { kind: 'cancelled' };
	}

	if (kinds.code) {
		data.code = await fetchCodeClasses(source, target, options);
	}
	if (options.isCancelled()) {
		return { kind: 'cancelled' };
	}

	return { kind: 'fetched', data };
}

/**
 * Fetch every custom class's source from **both** Vaults: an independent name query per Vault, then one
 * source GET at a time (the N+1 shape of ADR 0009/0010) across a shared progress counter. A failed GET
 * is caught, recorded as a {@link SdkDownloadFailure}, and the class kept with `source: undefined` and
 * its `error` so the diff classifies it Unavailable — the run keeps going.
 */
export async function fetchCodeClasses(
	source: CompareVaultPort,
	target: CompareVaultPort,
	options: CompareFetchOptions,
): Promise<CodeFetchResult> {
	options.onProgress?.(`Querying code from ${source.label}…`);
	const sourceNames = await source.queryCustomCodeNames(options.isCancelled);
	options.onProgress?.(`Querying code from ${target.label}…`);
	const targetNames = await target.queryCustomCodeNames(options.isCancelled);

	const counter = { done: 0, total: sourceNames.length + targetNames.length };
	const failures: SdkDownloadFailure[] = [];
	const sourceCode = await downloadSources(source, sourceNames, options, counter, failures);
	const targetCode = await downloadSources(target, targetNames, options, counter, failures);
	return { source: sourceCode, target: targetCode, failures };
}

/** Running tally shared across both Vaults' downloads so progress reads "N of total" over the whole run. */
interface DownloadCounter {
	done: number;
	total: number;
}

/** Download one Vault's class sources sequentially, recording failures and skipping the failed class. */
async function downloadSources(
	port: CompareVaultPort,
	names: string[],
	options: CompareFetchOptions,
	counter: DownloadCounter,
	failures: SdkDownloadFailure[],
): Promise<CodeClass[]> {
	const classes: CodeClass[] = [];
	for (const name of names) {
		if (options.isCancelled()) {
			break;
		}
		counter.done += 1;
		options.onProgress?.(`Downloading code ${counter.done} of ${counter.total}…`);
		try {
			const source = await port.retrieveSourceCode(name);
			classes.push({ name, source });
		} catch (error) {
			const reason = errorMessage(error);
			failures.push({ className: name, reason });
			classes.push({ name, source: undefined, error: reason });
		}
	}
	return classes;
}

/**
 * The partial-comparison summary, or `undefined` when every class fetched cleanly. Counts **distinct
 * classes** (a class on both sides is one entry): how many compared of how many, and which came out
 * Unavailable. Leads with the count and the first failure's reason, then lists each failed class on its
 * own line with the shared `com.veeva.vault.custom.` prefix stripped so the names stay scannable.
 */
export function summarizeCodeFetch(code: CodeFetchResult): string | undefined {
	const reasonByClass = new Map(code.failures.map((failure) => [failure.className, failure.reason]));
	if (reasonByClass.size === 0) {
		return undefined;
	}
	const distinct = [...new Set([...code.source, ...code.target].map((codeClass) => codeClass.name))];
	const unavailable = distinct.filter((name) => reasonByClass.has(name)).sort((a, b) => a.localeCompare(b));
	if (unavailable.length === 0) {
		return undefined;
	}
	const total = distinct.length;
	const compared = total - unavailable.length;
	const reason = reasonByClass.get(unavailable[0]) ?? 'source could not be retrieved';
	const failedList = unavailable.map((name) => customClassDisplayName(name)).join('\n');
	return `Compared ${compared} of ${total} (${unavailable.length} failed) — ${reason}\n${failedList}`;
}
