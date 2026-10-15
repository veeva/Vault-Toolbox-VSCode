import type { QueryRow } from '../rest/types';
import { partialFailureMessage } from '../partialFailureMessage';

/**
 * Pure planning for "Extract Java SDK Code from Vault": turn the class names returned by the custom-code
 * name query into the `.java` files to write. Kept vscode-free and fs-free so the package-tree layout is
 * unit-testable in isolation; the host task does the actual REST retrieval and file I/O.
 *
 * For a code component in `vault_component__v`, `component_name__v` **is** the fully-qualified Java class
 * name (e.g. `com.veeva.vault.custom.triggers.HelloWorld`), so a class maps onto a package-tree path by
 * splitting on `.` and appending `.java` to the final segment.
 */

/**
 * The extract-root-relative path segments for a class's `.java` file: the fully-qualified name split on
 * `.`, with `.java` appended to the final segment. e.g. `com.veeva.vault.custom.triggers.HelloWorld` →
 * `['com', 'veeva', 'vault', 'custom', 'triggers', 'HelloWorld.java']`.
 */
export function sourceFileSegments(className: string): string[] {
	const segments = className.split('.');
	const lastIndex = segments.length - 1;
	segments[lastIndex] = `${segments[lastIndex]}.java`;
	return segments;
}

/**
 * The simple class name from a fully-qualified name: the segment after the last `.` (the whole string
 * when there's no dot). e.g. `com.veeva.vault.custom.triggers.HelloWorld` → `HelloWorld`. Used to label a
 * class in the compare tree and to name the `.java` multipart file on a deploy.
 */
export function simpleClassName(className: string): string {
	const dot = className.lastIndexOf('.');
	return dot >= 0 ? className.slice(dot + 1) : className;
}

/** The `com.veeva.vault.custom.` package prefix every custom-code class shares (see {@link CUSTOM_CODE_QUERY}). */
export const CUSTOM_CODE_PACKAGE_PREFIX = 'com.veeva.vault.custom.';

/**
 * A custom class name with the shared `com.veeva.vault.custom.` package prefix stripped, for compact
 * display where every entry carries it (e.g. the compare download-failure summary). e.g.
 * `com.veeva.vault.custom.actions.Foo` → `actions.Foo`. A name that doesn't carry the prefix is returned
 * unchanged.
 */
export function customClassDisplayName(className: string): string {
	return className.startsWith(CUSTOM_CODE_PACKAGE_PREFIX)
		? className.slice(CUSTOM_CODE_PACKAGE_PREFIX.length)
		: className;
}

/**
 * The local `.java` files to delete so the extract folder mirrors Vault: existing source files whose
 * fully-qualified class is absent from the **queried** name set. Deliberately keyed on the queried set —
 * not the successfully-written set (as `core/mdl`'s `orphanedMdlFiles` is) — so a class Vault still has
 * but that failed to download this run is preserved, never mistaken for a deletion (ADR 0009). Only
 * `.java` files are ever returned; other files the developer placed in the tree are left untouched.
 * Both `existing` paths and the returned paths are forward-slashed and relative to the extract root.
 */
export function orphanedSdkFiles(existing: string[], queriedClassNames: Iterable<string>): string[] {
	const queried = new Set(queriedClassNames);
	return existing.filter((path) => path.endsWith('.java') && !queried.has(classNameFromPath(path)));
}

/**
 * One custom-code class whose source GET failed this run: the fully-qualified class name and the reason it
 * couldn't be downloaded (a transient 404/5xx, or a listed component whose source isn't retrievable). The
 * host records these as it skips past each failure; {@link sdkExtractionSummary} turns them into messaging.
 */
export interface SdkDownloadFailure {
	className: string;
	reason: string;
}

/** Shown (not a silent success) when the name query returns no custom code at all — nothing to extract. */
export const NO_CUSTOM_CODE_MESSAGE = 'No custom Java SDK code found.';

/**
 * Name query for every custom-code component's fully-qualified class name — for a code component
 * `component_name__v` *is* the class name, so the `LIKE` isolates custom code and excludes standard
 * `com.veeva.vault.{AppName}` system code. No status filter, so disabled/inactive code is included.
 * Run through the standard paginated `/query` path (not `/query/components`, which is for MDL/JSON
 * definitions). Shared by Extract Java SDK Code and the Compare Environments code fetch so the two
 * never drift.
 */
export const CUSTOM_CODE_QUERY =
	"SELECT component_name__v FROM vault_component__v WHERE component_name__v LIKE 'com.veeva.vault.custom%'";

/**
 * The completion message for a run that finished with one or more per-class download failures: how many of
 * how many landed, the failed class names, and the first failure's reason (mirroring the developer-log
 * partial-failure messages, which list the failed items then the leading reason). Pure and transport-free
 * so it is unit-testable; a run with zero failures never calls this (it shows a plain success toast).
 */
export function sdkExtractionSummary(written: number, failures: SdkDownloadFailure[]): string {
	if (failures.length === 0) {
		return '';
	}
	return partialFailureMessage(
		written,
		failures.map((failure) => failure.className),
		failures[0].reason,
		{ successVerb: 'Extracted' },
	);
}

/** Inverse of `sourceFileSegments`' layout: `com/.../HelloWorld.java` → `com...HelloWorld`. */
function classNameFromPath(path: string): string {
	return path.replace(/\.java$/, '').split('/').join('.');
}

/**
 * The custom-code class names from a page of `vault_component__v` rows: each row's non-empty
 * `component_name__v` (the fully-qualified class name). Rows missing the field, or carrying a blank /
 * non-string value, are skipped.
 */
export function customCodeClassNames(rows: readonly QueryRow[]): string[] {
	const names: string[] = [];
	for (const row of rows) {
		const name = row['component_name__v'];
		if (typeof name === 'string' && name.length > 0) {
			names.push(name);
		}
	}
	return names;
}
