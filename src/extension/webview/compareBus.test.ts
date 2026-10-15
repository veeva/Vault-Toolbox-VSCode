import { describe, it, expect, vi } from 'vitest';
import { CompareBus, type CompareRunner } from './compareBus';
import type { CompareRequest, HostToCompareMessage } from '../../shared/compareProtocol';

function makeBusFixture() {
	const runner: CompareRunner = {
		startCompare: vi.fn(
			(_request: CompareRequest, _signal: AbortSignal) =>
				Promise.resolve({ type: 'compareResult', status: 'success' } as const),
		),
		setApplyEnabled: vi.fn(),
		applySelected: vi.fn(),
		clearCompare: vi.fn(),
		hasSelection: vi.fn(() => false),
		getSessionState: vi.fn(() => undefined),
		onSessionStateChanged: vi.fn(() => () => {}),
		onSelectionChanged: vi.fn(() => () => {}),
	};
	const post = vi.fn();
	const bus = new CompareBus({ runner, post });
	return { bus, runner, post };
}

describe('CompareBus', () => {
	it('routes a startCompare message to the runner with both ids, the kinds, and posts the result', async () => {
		const { bus, runner, post } = makeBusFixture();

		await bus.handle({ type: 'startCompare', sourceId: 'src', targetId: 'tgt', kinds: { mdl: true, code: false } });

		expect(runner.startCompare).toHaveBeenCalledWith(
			{ sourceId: 'src', targetId: 'tgt', kinds: { mdl: true, code: false } },
			expect.any(AbortSignal),
		);
		expect(post).toHaveBeenCalledWith({ type: 'compareResult', status: 'success' });
	});

	it('routes setApplyEnabled to the runner', async () => {
		const { bus, runner } = makeBusFixture();

		await bus.handle({ type: 'setApplyEnabled', enabled: true });

		expect(runner.setApplyEnabled).toHaveBeenCalledWith(true);
	});

	it('drops a setApplyEnabled message with a non-boolean enabled', async () => {
		const { bus, runner } = makeBusFixture();

		await bus.handle({ type: 'setApplyEnabled', enabled: 'yes' });

		expect(runner.setApplyEnabled).not.toHaveBeenCalled();
	});

	it('surfaces a failure result back to the webview', async () => {
		const { runner, post } = makeBusFixture();
		runner.startCompare = vi.fn(() =>
			Promise.resolve({ type: 'compareResult', status: 'error', errorMessage: 'boom' } as const),
		);
		const bus = new CompareBus({ runner, post });

		await bus.handle({ type: 'startCompare', sourceId: 'src', targetId: 'tgt', kinds: { mdl: true, code: true } });

		expect(post).toHaveBeenCalledWith({
			type: 'compareResult',
			status: 'error',
			errorMessage: 'boom',
		});
	});

	it('aborts the in-flight run and suppresses its result when cancelled', async () => {
		const { runner, post } = makeBusFixture();
		let abortDuringRun: AbortSignal | undefined;
		let finishRun: () => void = () => undefined;
		runner.startCompare = vi.fn((_request, signal: AbortSignal) => {
			abortDuringRun = signal;
			return new Promise<HostToCompareMessage>((resolve) => {
				finishRun = () => resolve({ type: 'compareResult', status: 'success' });
			});
		});
		const bus = new CompareBus({ runner, post });

		const inFlight = bus.handle({ type: 'startCompare', sourceId: 'src', targetId: 'tgt', kinds: { mdl: true, code: true } });
		await bus.handle({ type: 'cancelCompare' }); // aborts while the run is still pending
		finishRun();
		await inFlight;

		expect(abortDuringRun?.aborted).toBe(true);
		expect(post).not.toHaveBeenCalled();
	});

	it('drops a startCompare message missing an id', async () => {
		const { bus, runner } = makeBusFixture();

		await bus.handle({ type: 'startCompare', sourceId: 'src', kinds: { mdl: true, code: true } });

		expect(runner.startCompare).not.toHaveBeenCalled();
	});

	it('drops a startCompare message missing kinds', async () => {
		const { bus, runner } = makeBusFixture();

		await bus.handle({ type: 'startCompare', sourceId: 'src', targetId: 'tgt' });

		expect(runner.startCompare).not.toHaveBeenCalled();
	});

	it('drops a startCompare message whose kinds are both off', async () => {
		const { bus, runner } = makeBusFixture();

		await bus.handle({ type: 'startCompare', sourceId: 'src', targetId: 'tgt', kinds: { mdl: false, code: false } });

		expect(runner.startCompare).not.toHaveBeenCalled();
	});

	it('routes clearCompare to the runner', async () => {
		const { bus, runner } = makeBusFixture();

		await bus.handle({ type: 'clearCompare' });

		expect(runner.clearCompare).toHaveBeenCalled();
	});

	it('replays the current selection when the selector signals it has mounted', async () => {
		const { bus, runner, post } = makeBusFixture();
		vi.mocked(runner.hasSelection).mockReturnValue(true);

		await bus.handle({ type: 'ready' });

		expect(post).toHaveBeenCalledWith({ type: 'selectionChanged', hasSelection: true });
	});

	it('replays the live comparison when the selector signals it has mounted', async () => {
		const { bus, runner, post } = makeBusFixture();
		const session = {
			sourceId: 'src',
			targetId: 'tgt',
			kinds: { mdl: false, code: true },
			applyEnabled: true,
		};
		vi.mocked(runner.getSessionState).mockReturnValue(session);

		await bus.handle({ type: 'ready' });

		expect(post).toHaveBeenCalledWith({ type: 'sessionState', session });
	});

	it('replays an absent comparison, so a selector mounting over nothing stays unlocked', async () => {
		const { bus, post } = makeBusFixture();

		await bus.handle({ type: 'ready' });

		expect(post).toHaveBeenCalledWith({ type: 'sessionState', session: undefined });
	});

	it('replays an empty selection too, so a stale enabled button is corrected', async () => {
		const { bus, post } = makeBusFixture();

		await bus.handle({ type: 'ready' });

		expect(post).toHaveBeenCalledWith({ type: 'selectionChanged', hasSelection: false });
	});

	it('drops a message with an unknown type', async () => {
		const { bus, runner } = makeBusFixture();

		await bus.handle({ type: 'nonsense' });

		expect(runner.startCompare).not.toHaveBeenCalled();
	});

	it('drops a non-object message without throwing', async () => {
		const { bus, runner } = makeBusFixture();

		await bus.handle(null);
		await bus.handle('not an object');

		expect(runner.startCompare).not.toHaveBeenCalled();
	});
});
