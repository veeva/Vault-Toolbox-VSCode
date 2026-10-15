/**
 * Locates the Configuration Report's download links among a finished job's links. Config-Report-specific
 * (it knows the report is a ZIP and the error log a CSV), so it lives here rather than in the generic
 * `core/job` polling module.
 */

import { hrefPath } from './reportArchive';
import type { JobStatusLink } from '../job/jobStatus';

/** The report ZIP and, when config issues occurred, the CSV error log located in a finished job. */
export interface ReportArtifacts {
	/** Download href for the report ZIP, if present. */
	reportHref?: string;
	/** Download href for the CSV error log, present only when the job hit config issues. */
	errorLogHref?: string;
}

/**
 * Locate the report and error-log download links among a finished job's links. Vault documents the
 * report as a ZIP and the error log as a CSV but does not pin down the link `rel` names or guarantee the
 * hrefs carry a file extension. So matching is layered, most-reliable first: the CSV/ZIP path extension
 * (present when the href carries a filename), then the `rel` name (for extension-less, rel-based
 * endpoints), and finally — for the report — the sole remaining non-`self` link. The error log is
 * resolved first so the report never mistakes it for the artifact.
 */
export function selectReportArtifacts(links: JobStatusLink[]): ReportArtifacts {
	const downloadable = links.filter((link) => link.rel.toLowerCase() !== 'self');
	const errorLogHref =
		links.find((link) => hasPathExtension(link.href, '.csv'))?.href ??
		downloadable.find((link) => /error|log/i.test(link.rel))?.href;
	const reportHref =
		links.find((link) => hasPathExtension(link.href, '.zip'))?.href ??
		downloadable.find((link) => link.href !== errorLogHref)?.href;
	return { reportHref, errorLogHref };
}

/** True when the URL's path (ignoring any query string) ends with `extension`, case-insensitively. */
function hasPathExtension(href: string, extension: string): boolean {
	return hrefPath(href).toLowerCase().endsWith(extension);
}
