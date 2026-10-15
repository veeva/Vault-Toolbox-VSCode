import type { ApiHistoryEntry } from '../rest/apiHistory';
import type { SdkCodeResult } from '../rest/types';
import { sdkErrorDetail, STATUS_SUCCESS, type SdkCodeOutcome } from './sdkDeploy';

/**
 * Pure logic for the "Delete from Vault" operation on a `.java` file (**Delete Java SDK Code**), kept
 * vscode-free so both the fully-qualified-class-name derivation and the outcome classification are
 * unit-testable in isolation. The extension command is a thin adapter over these functions, mirroring
 * `core/mdl`'s `mdlDrop` (see ADR 0005). The deploy sibling lives in `sdkDeploy`, whose
 * {@link SdkCodeOutcome}, {@link sdkErrorDetail} and {@link STATUS_SUCCESS} are reused so both
 * commands report identically.
 */

/**
 * A `package` declaration and its package name: a dotted Java identifier chain, captured up to the
 * terminating `;`. Anchored per-line (`m` flag) with only leading horizontal whitespace, so it matches
 * a real declaration rather than the word "package" mid-line.
 */
const PACKAGE_DECL = /^[ \t]*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m;

/** Detects that a `package` statement is *present* (parseable or not), to tell "no package" apart from
 *  "unparseable package". */
const PACKAGE_KEYWORD = /^[ \t]*package\b/m;

/** A derived fully-qualified class name, or a human-readable reason it couldn't be built. */
export type SdkClassNameParse =
	| { ok: true; className: string }
	| { ok: false; error: string };

/**
 * Derive the fully-qualified class name for a `.java` file from its `package` declaration plus its
 * filename (the class name is the basename minus `.java`). E.g. `package com.veeva.vault.custom.triggers;`
 * in `HelloWorld.java` → `com.veeva.vault.custom.triggers.HelloWorld`. Returns a specific failure — sending
 * nothing — when the file is empty/unreadable, carries no `package` declaration, or its `package` line
 * cannot be parsed, so the developer understands why nothing was deleted.
 */
export function deriveSdkClassName(source: string, fileName: string): SdkClassNameParse {
	const simpleName = classNameFromFileName(fileName);
	if (!simpleName) {
		return { ok: false, error: 'Could not read a class name from the file name.' };
	}
	if (source.trim().length === 0) {
		return {
			ok: false,
			error: 'This .java file is empty or unreadable; there is no class to delete.',
		};
	}
	const match = PACKAGE_DECL.exec(source);
	if (!match) {
		return {
			ok: false,
			error: PACKAGE_KEYWORD.test(source)
				? 'Could not read the package name from the `package` declaration in this .java file, so ' +
					'the fully-qualified class name cannot be built.'
				: 'This .java file has no `package` declaration, so the fully-qualified class name cannot ' +
					'be built. A Vault Java SDK source file must declare its package, e.g. ' +
					'`package com.veeva.vault.custom.triggers;`.',
		};
	}
	return { ok: true, className: `${match[1]}.${simpleName}` };
}

/** The simple class name from a `.java` filename: the basename with its `.java` extension removed. */
function classNameFromFileName(fileName: string): string {
	return fileName.replace(/\.java$/i, '');
}

/** Whether a `/code` delete result is a success — a `SUCCESS` envelope (FAILURE-on-2xx reads as failure). */
export function isSdkDeleteSuccess(result: SdkCodeResult): boolean {
	return result.responseStatus === STATUS_SUCCESS;
}

/**
 * Turn a delete result into a `{ ok, headline }` outcome for the notification toast. On success the
 * headline is a plain confirmation (the exact class was named in the confirmation modal); on failure it
 * leads with Vault's own message — including the "code component currently in use" rejection, which is a
 * normal error. The full request and raw response are one click away via **View API Call**.
 */
export function summarizeSdkDelete(result: SdkCodeResult): SdkCodeOutcome {
	const ok = isSdkDeleteSuccess(result);
	if (ok) {
		return { ok, headline: 'Delete from Vault succeeded' };
	}
	const detail = sdkErrorDetail(result);
	const title = 'Delete from Vault failed';
	return { ok, headline: detail ? `${title} — ${detail}` : title };
}

/** The versioned, class-scoped SDK-code delete endpoint a "Delete from Vault" DELETEs
 *  (`/api/{version}/code/{class_name}`) — distinct from the deploy PUT to the bare `/code`. */
export function isSdkDeleteCall(entry: ApiHistoryEntry): boolean {
	return entry.method === 'DELETE' && /\/code\/[^/?]+$/.test(entry.url);
}
