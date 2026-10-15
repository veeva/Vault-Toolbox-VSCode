import { describe, it, expect } from 'vitest';
import {
	hrefBasename,
	hrefPath,
	planReportFiles,
	runFolderSegment,
	sanitizeEntryPath,
} from './reportArchive';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sanitizeEntryPath', () => {
	it('keeps a plain nested path, normalizing backslashes', () => {
		expect(sanitizeEntryPath('report\\Objects\\object.xlsx')).toBe('report/Objects/object.xlsx');
	});

	it('strips leading `.` and empty segments', () => {
		expect(sanitizeEntryPath('./report//file.csv')).toBe('report/file.csv');
	});

	it('rejects `..` traversal', () => {
		expect(sanitizeEntryPath('../../etc/passwd')).toBeUndefined();
		expect(sanitizeEntryPath('report/../../secret')).toBeUndefined();
	});

	it('rejects absolute POSIX paths and Windows drive letters', () => {
		expect(sanitizeEntryPath('/etc/passwd')).toBeUndefined();
		expect(sanitizeEntryPath('C:/Windows/system32')).toBeUndefined();
	});

	it('rejects an entry that reduces to nothing', () => {
		expect(sanitizeEntryPath('.')).toBeUndefined();
		expect(sanitizeEntryPath('')).toBeUndefined();
	});
});

describe('planReportFiles', () => {
	it('plans each file, skipping directory entries', () => {
		const files = planReportFiles({
			'report/': new Uint8Array(),
			'report/config.xlsx': bytes('workbook'),
			'report/errors.csv': bytes('log'),
		});

		expect(files).toEqual([
			{ relativePath: 'report/config.xlsx', content: bytes('workbook') },
			{ relativePath: 'report/errors.csv', content: bytes('log') },
		]);
	});

	it('drops entries that fail the Zip-Slip guard', () => {
		const files = planReportFiles({
			'../escape.xlsx': bytes('evil'),
			'safe.xlsx': bytes('ok'),
		});

		expect(files).toEqual([{ relativePath: 'safe.xlsx', content: bytes('ok') }]);
	});
});

describe('runFolderSegment', () => {
	it('renders a filesystem-safe timestamp with no colons or fractional seconds', () => {
		expect(runFolderSegment(new Date('2026-08-25T16:04:17.123Z'))).toBe('2026-08-25T16-04-17');
	});
});

describe('hrefPath / hrefBasename', () => {
	it('strips the query string from the path', () => {
		expect(hrefPath('/jobs/1/report.zip?token=abc')).toBe('/jobs/1/report.zip');
	});

	it('takes the final path segment, ignoring the query string', () => {
		expect(hrefBasename('/jobs/1/errors.csv?token=abc')).toBe('errors.csv');
		expect(hrefBasename('report.zip')).toBe('report.zip');
	});
});
