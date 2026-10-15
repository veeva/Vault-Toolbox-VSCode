import { describe, it, expect } from 'vitest';
import type { ApiHistoryEntry } from '../rest/apiHistory';
import { isSdkDeployCall, isSdkDeploySuccess, summarizeSdkDeploy } from './sdkDeploy';

describe('isSdkDeploySuccess', () => {
	it('is true for a SUCCESS envelope', () => {
		expect(isSdkDeploySuccess({ responseStatus: 'SUCCESS' })).toBe(true);
	});

	it('is false for a FAILURE envelope (including FAILURE-on-2xx)', () => {
		expect(isSdkDeploySuccess({ responseStatus: 'FAILURE' })).toBe(false);
		expect(isSdkDeploySuccess({ responseStatus: 'EXCEPTION' })).toBe(false);
	});
});

describe('summarizeSdkDeploy', () => {
	it('surfaces the returned fully-qualified class name (url) on success', () => {
		const outcome = summarizeSdkDeploy({
			responseStatus: 'SUCCESS',
			url: 'com.veeva.vault.custom.triggers.HelloWorld',
		});
		expect(outcome.ok).toBe(true);
		expect(outcome.headline).toBe(
			'Deploy to Vault succeeded — com.veeva.vault.custom.triggers.HelloWorld',
		);
	});

	it('falls back to a bare success title when Vault echoes no url', () => {
		expect(summarizeSdkDeploy({ responseStatus: 'SUCCESS' }).headline).toBe(
			'Deploy to Vault succeeded',
		);
	});

	it("leads a failure with Vault's structured error message", () => {
		const outcome = summarizeSdkDeploy({
			responseStatus: 'FAILURE',
			errors: [{ type: 'INVALID_DATA', message: 'Package must be com.veeva.vault.custom.' }],
		});
		expect(outcome.ok).toBe(false);
		expect(outcome.headline).toBe(
			'Deploy to Vault failed — Package must be com.veeva.vault.custom.',
		);
	});

	it('falls back to responseMessage when there is no structured error', () => {
		expect(
			summarizeSdkDeploy({ responseStatus: 'FAILURE', responseMessage: 'File too large.' })
				.headline,
		).toBe('Deploy to Vault failed — File too large.');
	});

	it('falls back to a bare failure title when no message is present', () => {
		expect(summarizeSdkDeploy({ responseStatus: 'FAILURE' }).headline).toBe(
			'Deploy to Vault failed',
		);
	});
});

describe('isSdkDeployCall', () => {
	const entry = (over: Partial<ApiHistoryEntry>): ApiHistoryEntry =>
		({ method: 'PUT', url: 'https://x.veevavault.com/api/v26.2/code', ...over }) as ApiHistoryEntry;

	it('matches a PUT to the versioned /code endpoint', () => {
		expect(isSdkDeployCall(entry({}))).toBe(true);
	});

	it('does not match other methods or a class-scoped /code/{class} path', () => {
		expect(isSdkDeployCall(entry({ method: 'GET' }))).toBe(false);
		expect(
			isSdkDeployCall(entry({ method: 'DELETE', url: 'https://x/api/v26.2/code/com.a.B' })),
		).toBe(false);
	});
});
