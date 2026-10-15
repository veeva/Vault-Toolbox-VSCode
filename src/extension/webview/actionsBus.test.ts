import { describe, it, expect, vi } from 'vitest';
import { ActionsBus, type ActionRunner } from './actionsBus';
import type { HostToActionsMessage } from '../../shared/actionsProtocol';
import { DEFAULT_CONFIG_REPORT_PARAMETERS } from '../../core/configReport/reportParameters';

function busWith() {
	const runner: ActionRunner = {
		run: vi.fn(() => Promise.resolve()),
		runConfigReport: vi.fn((_params, _signal: AbortSignal) =>
			Promise.resolve({ type: 'configReportResult', status: 'success' } as const),
		),
		openConfigReportSetting: vi.fn(),
		configReportLocation: vi.fn(() => 'vault-toolbox/config/1234'),
		runApiUsageLog: vi.fn((_params, _signal: AbortSignal) =>
			Promise.resolve({ type: 'apiUsageLogResult', status: 'success' } as const),
		),
		openDeveloperLogsSetting: vi.fn(),
		apiUsageLogLocation: vi.fn(() => 'vault-toolbox/logs/1234/api-usage'),
		runSdkRuntimeLog: vi.fn((_params, _signal: AbortSignal) =>
			Promise.resolve({ type: 'sdkRuntimeLogResult', status: 'success' } as const),
		),
		sdkRuntimeLogLocation: vi.fn(() => 'vault-toolbox/logs/1234/sdk-runtime'),
		retrieveComponentTypes: vi.fn(() => Promise.resolve(['Doclifecycle', 'Doctype'])),
		saveConfigReportSettings: vi.fn(() => Promise.resolve()),
		loadConfigReportSettings: vi.fn(() => undefined),
	};
	const post = vi.fn();
	const bus = new ActionsBus({ runner, post });
	return { bus, runner, post };
}

describe('ActionsBus action routing', () => {
	it('routes a runAction message to the runner with its id', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'runAction', id: 'extractMdlFromVault' });

		expect(runner.run).toHaveBeenCalledWith('extractMdlFromVault');
	});

	it('drops a runAction message whose id is not a known action', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'runAction', id: 'nonsense' });

		expect(runner.run).not.toHaveBeenCalled();
	});

	it('drops a runAction message whose id is missing or not a string', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'runAction' });
		await bus.handle({ type: 'runAction', id: 42 });

		expect(runner.run).not.toHaveBeenCalled();
	});

	it('routes a runConfigReport message to the runner with its parameters and posts the result', async () => {
		const { bus, runner, post } = busWith();

		await bus.handle({ type: 'runConfigReport', params: DEFAULT_CONFIG_REPORT_PARAMETERS });

		expect(runner.runConfigReport).toHaveBeenCalledWith(
			DEFAULT_CONFIG_REPORT_PARAMETERS,
			expect.any(AbortSignal),
		);
		expect(post).toHaveBeenCalledWith({ type: 'configReportResult', status: 'success' });
	});

	it('drops a runConfigReport message with malformed parameters', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'runConfigReport', params: { includeVaultSettings: 'yes' } });

		expect(runner.runConfigReport).not.toHaveBeenCalled();
	});

	it('suppresses the posted result when the run was cancelled via cancelConfigReport', async () => {
		const { runner, post } = busWith();
		let abortDuringRun: AbortSignal | undefined;
		let finishRun: () => void = () => undefined;
		runner.runConfigReport = vi.fn((_params, signal: AbortSignal) => {
			abortDuringRun = signal;
			return new Promise<HostToActionsMessage>((resolve) => {
				finishRun = () => resolve({ type: 'configReportResult', status: 'success' });
			});
		});
		const bus = new ActionsBus({ runner, post });

		const inFlight = bus.handle({ type: 'runConfigReport', params: DEFAULT_CONFIG_REPORT_PARAMETERS });
		await bus.handle({ type: 'cancelConfigReport' }); // aborts while the run is still pending
		finishRun();
		await inFlight;

		expect(abortDuringRun?.aborted).toBe(true);
		expect(post).not.toHaveBeenCalled();
	});

	it('routes an openConfigReportSetting message to the runner', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'openConfigReportSetting' });

		expect(runner.openConfigReportSetting).toHaveBeenCalledTimes(1);
	});

	it('posts the resolved write location in reply to requestConfigReportLocation', async () => {
		const { bus, runner, post } = busWith();

		await bus.handle({ type: 'requestConfigReportLocation' });

		expect(runner.configReportLocation).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenCalledWith({
			type: 'configReportLocation',
			path: 'vault-toolbox/config/1234',
		});
	});

	it('posts an undefined path when the location cannot be resolved', async () => {
		const { bus, runner, post } = busWith();
		runner.configReportLocation = vi.fn(() => undefined);

		await bus.handle({ type: 'requestConfigReportLocation' });

		expect(post).toHaveBeenCalledWith({ type: 'configReportLocation', path: undefined });
	});

	it('routes a runApiUsageLog message to the runner with its params and posts the result', async () => {
		const { bus, runner, post } = busWith();

		await bus.handle({ type: 'runApiUsageLog', params: { dates: ['2026-08-27'], logFormat: 'logfile' } });

		expect(runner.runApiUsageLog).toHaveBeenCalledWith(
			{ dates: ['2026-08-27'], logFormat: 'logfile' },
			expect.any(AbortSignal),
		);
		expect(post).toHaveBeenCalledWith({ type: 'apiUsageLogResult', status: 'success' });
	});

	it('drops a runApiUsageLog message whose dates is not an array of strings', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'runApiUsageLog', params: { dates: [42], logFormat: 'csv' } });

		expect(runner.runApiUsageLog).not.toHaveBeenCalled();
	});

	it('drops a runApiUsageLog message whose format is not a known value', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'runApiUsageLog', params: { dates: ['2026-08-27'], logFormat: 'pdf' } });

		expect(runner.runApiUsageLog).not.toHaveBeenCalled();
	});

	it('suppresses the posted result when the run was cancelled via cancelApiUsageLog', async () => {
		const { runner, post } = busWith();
		let abortDuringRun: AbortSignal | undefined;
		let finishRun: () => void = () => undefined;
		runner.runApiUsageLog = vi.fn((_params, signal: AbortSignal) => {
			abortDuringRun = signal;
			return new Promise<HostToActionsMessage>((resolve) => {
				finishRun = () => resolve({ type: 'apiUsageLogResult', status: 'success' });
			});
		});
		const bus = new ActionsBus({ runner, post });

		const inFlight = bus.handle({ type: 'runApiUsageLog', params: { dates: ['2026-08-27'], logFormat: 'csv' } });
		await bus.handle({ type: 'cancelApiUsageLog' }); // aborts while the run is still pending
		finishRun();
		await inFlight;

		expect(abortDuringRun?.aborted).toBe(true);
		expect(post).not.toHaveBeenCalled();
	});

	it('routes an openDeveloperLogsSetting message to the runner', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'openDeveloperLogsSetting' });

		expect(runner.openDeveloperLogsSetting).toHaveBeenCalledTimes(1);
	});

	it('posts the resolved write location in reply to requestApiUsageLogLocation', async () => {
		const { bus, runner, post } = busWith();

		await bus.handle({ type: 'requestApiUsageLogLocation' });

		expect(runner.apiUsageLogLocation).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenCalledWith({
			type: 'apiUsageLogLocation',
			path: 'vault-toolbox/logs/1234/api-usage',
		});
	});

	it('posts an undefined log path when the location cannot be resolved', async () => {
		const { bus, runner, post } = busWith();
		runner.apiUsageLogLocation = vi.fn(() => undefined);

		await bus.handle({ type: 'requestApiUsageLogLocation' });

		expect(post).toHaveBeenCalledWith({ type: 'apiUsageLogLocation', path: undefined });
	});

	it('routes a runSdkRuntimeLog message to the runner with its params and posts the result', async () => {
		const { bus, runner, post } = busWith();

		await bus.handle({ type: 'runSdkRuntimeLog', params: { dates: ['2026-08-27'], logFormat: 'logfile' } });

		expect(runner.runSdkRuntimeLog).toHaveBeenCalledWith(
			{ dates: ['2026-08-27'], logFormat: 'logfile' },
			expect.any(AbortSignal),
		);
		expect(post).toHaveBeenCalledWith({ type: 'sdkRuntimeLogResult', status: 'success' });
	});

	it('drops a runSdkRuntimeLog message whose dates is not an array of strings', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'runSdkRuntimeLog', params: { dates: [42], logFormat: 'csv' } });

		expect(runner.runSdkRuntimeLog).not.toHaveBeenCalled();
	});

	it('drops a runSdkRuntimeLog message whose format is not a known value', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'runSdkRuntimeLog', params: { dates: ['2026-08-27'], logFormat: 'pdf' } });

		expect(runner.runSdkRuntimeLog).not.toHaveBeenCalled();
	});

	it('suppresses the posted result when the run was cancelled via cancelSdkRuntimeLog', async () => {
		const { runner, post } = busWith();
		let abortDuringRun: AbortSignal | undefined;
		let finishRun: () => void = () => undefined;
		runner.runSdkRuntimeLog = vi.fn((_params, signal: AbortSignal) => {
			abortDuringRun = signal;
			return new Promise<HostToActionsMessage>((resolve) => {
				finishRun = () => resolve({ type: 'sdkRuntimeLogResult', status: 'success' });
			});
		});
		const bus = new ActionsBus({ runner, post });

		const inFlight = bus.handle({ type: 'runSdkRuntimeLog', params: { dates: ['2026-08-27'], logFormat: 'csv' } });
		await bus.handle({ type: 'cancelSdkRuntimeLog' }); // aborts while the run is still pending
		finishRun();
		await inFlight;

		expect(abortDuringRun?.aborted).toBe(true);
		expect(post).not.toHaveBeenCalled();
	});

	it('posts the resolved write location in reply to requestSdkRuntimeLogLocation', async () => {
		const { bus, runner, post } = busWith();

		await bus.handle({ type: 'requestSdkRuntimeLogLocation' });

		expect(runner.sdkRuntimeLogLocation).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenCalledWith({
			type: 'sdkRuntimeLogLocation',
			path: 'vault-toolbox/logs/1234/sdk-runtime',
		});
	});

	it('posts an undefined log path when the SDK runtime location cannot be resolved', async () => {
		const { bus, runner, post } = busWith();
		runner.sdkRuntimeLogLocation = vi.fn(() => undefined);

		await bus.handle({ type: 'requestSdkRuntimeLogLocation' });

		expect(post).toHaveBeenCalledWith({ type: 'sdkRuntimeLogLocation', path: undefined });
	});

	it('drops a message with an unknown type', async () => {
		const { bus, runner } = busWith();

		await bus.handle({ type: 'nonsense' });

		expect(runner.run).not.toHaveBeenCalled();
	});

	it('drops a non-object message without throwing', async () => {
		const { bus, runner } = busWith();

		await bus.handle(null);
		await bus.handle('not an object');

		expect(runner.run).not.toHaveBeenCalled();
	});
});
