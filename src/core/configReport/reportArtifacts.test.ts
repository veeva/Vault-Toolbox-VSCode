import { describe, it, expect } from 'vitest';
import { selectReportArtifacts } from './reportArtifacts';

describe('selectReportArtifacts', () => {
	it('finds the ZIP report and CSV error log by path extension', () => {
		const artifacts = selectReportArtifacts([
			{ rel: 'self', href: '/api/v26.2/services/jobs/43902' },
			{ rel: 'artifacts', href: '/api/v26.2/services/jobs/43902/artifacts/report.zip' },
			{ rel: 'errorlog', href: '/api/v26.2/services/jobs/43902/artifacts/errors.csv' },
		]);

		expect(artifacts.reportHref).toBe('/api/v26.2/services/jobs/43902/artifacts/report.zip');
		expect(artifacts.errorLogHref).toBe('/api/v26.2/services/jobs/43902/artifacts/errors.csv');
	});

	it('ignores a query string when matching the extension', () => {
		const artifacts = selectReportArtifacts([
			{ rel: 'file', href: '/download/report.zip?token=abc123' },
		]);

		expect(artifacts.reportHref).toBe('/download/report.zip?token=abc123');
	});

	it('leaves the error log undefined when only a report is present', () => {
		const artifacts = selectReportArtifacts([{ rel: 'file', href: '/report.ZIP' }]);

		expect(artifacts.reportHref).toBe('/report.ZIP');
		expect(artifacts.errorLogHref).toBeUndefined();
	});

	it('falls back to the sole non-self link when hrefs carry no file extension', () => {
		const artifacts = selectReportArtifacts([
			{ rel: 'self', href: '/api/v26.2/services/jobs/43902' },
			{ rel: 'artifacts', href: '/api/v26.2/services/jobs/43902/artifacts' },
		]);

		expect(artifacts.reportHref).toBe('/api/v26.2/services/jobs/43902/artifacts');
		expect(artifacts.errorLogHref).toBeUndefined();
	});

	it('separates report from error log by rel when neither href has an extension', () => {
		const artifacts = selectReportArtifacts([
			{ rel: 'self', href: '/jobs/1' },
			{ rel: 'artifacts', href: '/jobs/1/artifacts' },
			{ rel: 'errorlog', href: '/jobs/1/errorlog' },
		]);

		expect(artifacts.reportHref).toBe('/jobs/1/artifacts');
		expect(artifacts.errorLogHref).toBe('/jobs/1/errorlog');
	});

	it('does not treat a lone error-log link as the report', () => {
		const artifacts = selectReportArtifacts([
			{ rel: 'self', href: '/jobs/1' },
			{ rel: 'errorlog', href: '/jobs/1/errors.csv' },
		]);

		expect(artifacts.errorLogHref).toBe('/jobs/1/errors.csv');
		expect(artifacts.reportHref).toBeUndefined();
	});
});
