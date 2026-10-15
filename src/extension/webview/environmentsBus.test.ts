import { describe, it, expect, vi } from 'vitest';
import { AuthType, type Environment } from '../../core/models/environment';
import type { ConnectionState } from '../connection/types';
import type { HostToEnvironmentsMessage } from '../../shared/environmentsProtocol';
import { EnvironmentsBus, type EnvironmentActions } from './environmentsBus';

const SANDBOX: Environment = {
	id: 'e1',
	label: 'Sandbox',
	vaultDNS: 'myco.veevavault.com',
	authType: AuthType.Basic,
	username: 'admin',
};

function busWith(onReady?: () => void) {
	const posted: HostToEnvironmentsMessage[] = [];
	const actions: EnvironmentActions = {
		connect: vi.fn(() => Promise.resolve()),
		disconnect: vi.fn(() => Promise.resolve()),
		setActive: vi.fn(() => Promise.resolve()),
		remove: vi.fn(() => Promise.resolve()),
		openVault: vi.fn(() => Promise.resolve()),
		submitForm: vi.fn(() => Promise.resolve()),
	};
	const bus = new EnvironmentsBus({
		environments: { list: () => [SANDBOX], getActiveId: () => 'e1' },
		connection: { getConnectionState: (): ConnectionState => ({ status: 'disconnected' }) },
		actions,
		post: (message) => posted.push(message),
		onReady,
	});
	return { bus, actions, posted };
}

describe('EnvironmentsBus snapshot', () => {
	it('pushes a snapshot of the environments on ready', async () => {
		const { bus, posted } = busWith();

		await bus.handle({ type: 'ready' });

		expect(posted).toHaveLength(1);
		const [message] = posted;
		if (message.type !== 'snapshot') {
			throw new Error('expected a snapshot message');
		}
		expect(message.snapshot.environments.map((row) => row.id)).toEqual(['e1']);
	});
});

describe('EnvironmentsBus reveal', () => {
	it('posts a reveal immediately once the webview is ready', async () => {
		const { bus, posted } = busWith();
		await bus.handle({ type: 'ready' });
		posted.length = 0;

		bus.pushReveal();

		expect(posted).toEqual([{ type: 'reveal' }]);
	});

	it('posts a reveal immediately regardless of ready state', async () => {
		const { bus, posted } = busWith();

		bus.pushReveal();

		expect(posted).toEqual([{ type: 'reveal' }]);
	});

	it('calls onReady when the ready message is received', async () => {
		const onReady = vi.fn();
		const { bus } = busWith(onReady);

		await bus.handle({ type: 'ready' });

		expect(onReady).toHaveBeenCalledOnce();
	});
});

describe('EnvironmentsBus action routing', () => {
	it('routes a connect message to the connect action with its id', async () => {
		const { bus, actions } = busWith();

		await bus.handle({ type: 'connect', id: 'e1' });

		expect(actions.connect).toHaveBeenCalledWith('e1');
	});

	it('drops a connect message whose id is not a string', async () => {
		const { bus, actions } = busWith();

		await bus.handle({ type: 'connect', id: 42 });

		expect(actions.connect).not.toHaveBeenCalled();
	});

	it('drops a message with an unknown type', async () => {
		const { bus, actions, posted } = busWith();

		await bus.handle({ type: 'nonsense' });

		expect(actions.connect).not.toHaveBeenCalled();
		expect(posted).toEqual([]);
	});

	it('routes disconnect, setActive, and remove to their actions with their id', async () => {
		const { bus, actions } = busWith();

		await bus.handle({ type: 'disconnect', id: 'e1' });
		await bus.handle({ type: 'setActive', id: 'e1' });
		await bus.handle({ type: 'remove', id: 'e1' });

		expect(actions.disconnect).toHaveBeenCalledWith('e1');
		expect(actions.setActive).toHaveBeenCalledWith('e1');
		expect(actions.remove).toHaveBeenCalledWith('e1');
	});

	it('drops a disconnect message whose id is not a string', async () => {
		const { bus, actions } = busWith();

		await bus.handle({ type: 'disconnect', id: 42 });

		expect(actions.disconnect).not.toHaveBeenCalled();
	});

	it('routes an openVault message to the openVault action with its id', async () => {
		const { bus, actions } = busWith();

		await bus.handle({ type: 'openVault', id: 'e1' });

		expect(actions.openVault).toHaveBeenCalledWith('e1');
	});

	it('drops an openVault message whose id is not a string', async () => {
		const { bus, actions } = busWith();

		await bus.handle({ type: 'openVault', id: 42 });

		expect(actions.openVault).not.toHaveBeenCalled();
	});

	it('routes a submitForm message to the submitForm action with the full submission', async () => {
		const { bus, actions } = busWith();
		const submit = {
			type: 'submitForm' as const,
			mode: 'add' as const,
			vaultDNS: 'myco.veevavault.com',
			authType: AuthType.Basic,
			secret: 'hunter2',
		};

		await bus.handle(submit);

		expect(actions.submitForm).toHaveBeenCalledWith(submit);
	});
});
