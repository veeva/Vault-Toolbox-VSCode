/**
 * Pure planning for writing an unzipped Configuration Report to disk: sanitize each archive entry's
 * path (Zip-Slip guard) and compute the run-folder segment. Kept vscode-free and fs-free so the
 * path sanitization and layout are unit-testable in isolation; the host task decodes the ZIP and does
 * the actual writes.
 */

/** One file to write from the report archive: a sanitized relative path plus its bytes. */
export interface PlannedReportFile {
	/** Forward-slashed path relative to the run folder, guaranteed not to escape it. */
	relativePath: string;
	content: Uint8Array;
}

/**
 * Plan the files to write from a decoded ZIP's entries (path → bytes). Directory entries (trailing
 * slash) are skipped, and every entry is run through {@link sanitizeEntryPath}: any path that would
 * escape the destination (absolute, Windows drive-qualified, or containing a `..` segment) is dropped
 * rather than written, so a malicious or malformed archive cannot plant files outside the run folder.
 */
export function planReportFiles(entries: Record<string, Uint8Array>): PlannedReportFile[] {
	const files: PlannedReportFile[] = [];
	for (const [name, content] of Object.entries(entries)) {
		if (name.endsWith('/')) {
			continue; // directory entry — nothing to write
		}
		const relativePath = sanitizeEntryPath(name);
		if (relativePath) {
			files.push({ relativePath, content });
		}
	}
	return files;
}

/**
 * Reduce a ZIP entry name to a safe forward-slashed relative path, or `undefined` when it cannot be
 * made safe. Rejects absolute paths, Windows drive letters, and any `..` traversal; strips `.` and
 * empty segments. The result never escapes the directory it is later joined to.
 */
export function sanitizeEntryPath(name: string): string | undefined {
	const normalized = name.replace(/\\/g, '/');
	if (normalized.startsWith('/')) {
		return undefined; // absolute POSIX path
	}
	const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.');
	if (segments.length === 0) {
		return undefined;
	}
	if (segments.some((segment) => segment === '..')) {
		return undefined; // traversal — refuse rather than clamp
	}
	if (/^[a-zA-Z]:$/.test(segments[0])) {
		return undefined; // Windows drive letter (e.g. `C:`)
	}
	return segments.join('/');
}

/**
 * A filesystem-safe folder name for one report run, derived from the run's timestamp. Colons (illegal
 * on Windows) and the fractional seconds are dropped, leaving e.g. `2026-08-25T16-04-17`. Pure over an
 * injected `Date` so the layout is testable without a clock.
 */
export function runFolderSegment(runAt: Date): string {
	return runAt.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-');
}

/** The href's path with any query string removed (e.g. `/a/b.csv?token=x` → `/a/b.csv`). */
export function hrefPath(href: string): string {
	return href.split('?', 1)[0];
}

/** The final path segment of an href, ignoring any query string (e.g. `/jobs/1/report.zip` → `report.zip`). */
export function hrefBasename(href: string): string {
	const path = hrefPath(href);
	return path.substring(path.lastIndexOf('/') + 1);
}
