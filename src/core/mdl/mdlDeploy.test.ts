import { describe, it, expect } from 'vitest';
import type { MdlExecuteResult } from '../rest/types';
import { isMdlDeploySuccess, summarizeMdlDeploy } from './mdlDeploy';

const DNS = 'myco.veevavault.com';

function result(overrides: Partial<MdlExecuteResult> = {}): MdlExecuteResult {
	return {
		responseStatus: 'SUCCESS',
		scriptExecution: { code: 'GEN-S-0', message: 'OK', warnings: 0, failures: 0, exceptions: 0 },
		statements: [
			{ statement: 1, command: 'RECREATE', message: '[SUCCESS] RECREATE', response: 'SUCCESS' },
		],
		...overrides,
	};
}

describe('isMdlDeploySuccess', () => {
	it('is true for a clean SUCCESS envelope with all-SUCCESS statements', () => {
		expect(isMdlDeploySuccess(result())).toBe(true);
	});

	it('is true for a WARNING envelope with no failures or exceptions', () => {
		const r = result({
			responseStatus: 'WARNING',
			scriptExecution: { warnings: 2, failures: 0, exceptions: 0 },
		});
		expect(isMdlDeploySuccess(r)).toBe(true);
	});

	it('treats missing counts as zero (success)', () => {
		const r = result({ scriptExecution: {} });
		expect(isMdlDeploySuccess(r)).toBe(true);
	});

	it('is false when the script reports failures, even on a SUCCESS envelope', () => {
		const r = result({ scriptExecution: { warnings: 0, failures: 1, exceptions: 0 } });
		expect(isMdlDeploySuccess(r)).toBe(false);
	});

	it('is false when the script reports exceptions', () => {
		const r = result({ scriptExecution: { warnings: 0, failures: 0, exceptions: 1 } });
		expect(isMdlDeploySuccess(r)).toBe(false);
	});

	it('is false when any statement response is not SUCCESS', () => {
		const r = result({
			statements: [
				{ statement: 1, message: '[SUCCESS] a', response: 'SUCCESS' },
				{ statement: 2, message: '[FAILURE] b', response: 'FAILURE' },
			],
		});
		expect(isMdlDeploySuccess(r)).toBe(false);
	});

	it('is false for a FAILURE envelope with no statements', () => {
		const r = result({
			responseStatus: 'FAILURE',
			scriptExecution: undefined,
			statements: [],
			errors: [{ type: 'MALFORMED_MDL', message: 'must start with CREATE/RECREATE/...' }],
		});
		expect(isMdlDeploySuccess(r)).toBe(false);
	});
});

describe('summarizeMdlDeploy', () => {
	it('reports a success headline with the components-affected count', () => {
		const outcome = summarizeMdlDeploy(
			result({
				scriptExecution: {
					message: 'OK',
					warnings: 0,
					failures: 0,
					exceptions: 0,
					componentsAffected: 1,
					executionTime: 0.028,
				},
			}),
		);

		expect(outcome.ok).toBe(true);
		expect(outcome.headline).toMatch(/succeeded/i);
		expect(outcome.headline).toContain('Components affected: 1');
	});

	it('falls back to "Statement N: RESPONSE" when a failing statement has no message', () => {
		const outcome = summarizeMdlDeploy(
			result({
				responseStatus: 'FAILURE',
				scriptExecution: { failures: 1 },
				statements: [{ statement: 2, response: 'FAILURE' }],
			}),
		);

		expect(outcome.headline).toContain('Statement 2: FAILURE');
	});

	it('reports a failure headline and surfaces the failing statement message', () => {
		const outcome = summarizeMdlDeploy(
			result({
				responseStatus: 'FAILURE',
				scriptExecution: { message: 'Syntax error', warnings: 0, failures: 1, exceptions: 0 },
				statements: [{ statement: 1, message: '[FAILURE] Unexpected token', response: 'FAILURE' }],
			}),
		);

		expect(outcome.ok).toBe(false);
		expect(outcome.headline).toMatch(/failed/i);
		expect(outcome.headline).toContain('Failures: 1');
		expect(outcome.headline).toContain('Syntax error');
		expect(outcome.headline).toContain('[FAILURE] Unexpected token');
	});

	it('leads the failure headline with the error and suppresses zero-valued counts', () => {
		const outcome = summarizeMdlDeploy(
			result({
				responseStatus: 'FAILURE',
				scriptExecution: {
					message: 'Syntax error',
					warnings: 0,
					failures: 1,
					exceptions: 0,
					componentsAffected: 0,
					executionTime: 0.002,
				},
				statements: [
					{ statement: 2, message: '[Statement 2 line 12:8 mismatched input]', response: 'FAILURE' },
				],
			}),
		);

		const errorIndex = outcome.headline.indexOf('Syntax error');
		const failuresIndex = outcome.headline.indexOf('Failures: 1');
		expect(errorIndex).toBeGreaterThanOrEqual(0);
		expect(errorIndex).toBeLessThan(failuresIndex);
		expect(outcome.headline).toContain('[Statement 2 line 12:8 mismatched input]');
		expect(outcome.headline).not.toContain('Warnings: 0');
		expect(outcome.headline).not.toContain('Exceptions: 0');
		expect(outcome.headline).not.toContain('Components affected: 0');
	});

	it('omits the target DNS and execution time from the headline', () => {
		const outcome = summarizeMdlDeploy(
			result({
				responseStatus: 'FAILURE',
				scriptExecution: { message: 'Syntax error', failures: 1, executionTime: 0.002 },
				statements: [{ statement: 2, message: '[FAILURE] boom', response: 'FAILURE' }],
			}),
		);

		expect(outcome.headline).not.toContain(DNS);
		expect(outcome.headline).not.toContain('Target:');
		expect(outcome.headline).not.toContain('0.002s');
	});

	it('keeps the success headline single-line with components affected', () => {
		const outcome = summarizeMdlDeploy(
			result({
				scriptExecution: { message: 'OK', warnings: 0, failures: 0, componentsAffected: 3 },
			}),
		);

		expect(outcome.headline).not.toContain('\n');
		expect(outcome.headline).toMatch(/succeeded/i);
		expect(outcome.headline).toContain('Components affected: 3');
		expect(outcome.headline).not.toContain(DNS);
	});

	it('surfaces envelope-level error messages when there are no statements', () => {
		const outcome = summarizeMdlDeploy(
			result({
				responseStatus: 'FAILURE',
				scriptExecution: undefined,
				statements: [],
				errors: [{ type: 'MALFORMED_MDL', message: 'must start with CREATE/RECREATE/...' }],
			}),
		);

		expect(outcome.ok).toBe(false);
		expect(outcome.headline).toMatch(/failed/i);
		expect(outcome.headline).toContain('must start with CREATE/RECREATE/...');
	});
});
