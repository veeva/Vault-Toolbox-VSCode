import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ConnectionSnapshot } from '../../shared/vqlProtocol';
import { createMetadataStore, type MetadataStore, type MetadataStoreDeps } from './metadataStore';

/**
 * Store↔UI binding test: drives the real `metadataStore` through a connection change and asserts a
 * `useMetadata`-bound component re-renders. This closes the store↔UI desync gap — the store's node
 * unit test proves the snapshot changes, but not that `useSyncExternalStore` propagates it to React.
 *
 * The singleton is replaced with a store built over fake deps so the test controls the connection
 * stream and the `SHOW TARGETS` pre-warm.
 */

// Capture the connection handler the store subscribes, so the test can push snapshots.
let connectionHandler: ((state: ConnectionSnapshot) => void) | undefined;
let testStore: MetadataStore;

// Return one more target per call, so each Vault's pre-warm yields an observably different count —
// letting the switch test prove the re-warm re-rendered rather than reading a coincidentally-equal value.
let targetsCallCount = 0;

const fakeDeps: MetadataStoreDeps = {
	requestTargets: vi.fn(async () => {
		targetsCallCount += 1;
		return Array.from({ length: targetsCallCount }, (_unused, index) => ({
			name: `object_${index}__v`,
			label: `Object ${index}`,
		}));
	}),
	requestConfigurableObjects: vi.fn(async () => []),
	requestFields: vi.fn(async () => []),
	requestRelationships: vi.fn(async () => []),
	requestPicklistFields: vi.fn(async () => ({})),
	requestPicklistValues: vi.fn(async () => []),
	onConnectionState: (handler) => {
		connectionHandler = handler;
		return () => {
			connectionHandler = undefined;
		};
	},
};

vi.mock('./metadataStoreSingleton', () => ({
	get metadataStore() {
		return testStore;
	},
}));

beforeEach(() => {
	targetsCallCount = 0;
	testStore = createMetadataStore(fakeDeps);
});

// Imported after the mock is registered so it binds to the faked singleton.
const { useMetadata } = await import('./useMetadata');

function TargetsProbe(): JSX.Element {
	const snapshot = useMetadata();
	return <div data-testid="targets">{snapshot.index.objectSummaries().length}</div>;
}

describe('useMetadata store binding', () => {
	it('re-renders the bound component when the store warms targets after a connect', async () => {
		render(<TargetsProbe />);
		expect(screen.getByTestId('targets')).toHaveTextContent('0');

		// A connect to a new Vault resets and pre-warms SHOW TARGETS; the async load then notifies.
		await act(async () => {
			connectionHandler?.({ status: 'connected', vaultDns: 'acme.veevavault.com', isProduction: false });
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(screen.getByTestId('targets')).toHaveTextContent('1');
	});

	it('re-renders on a Vault switch that resets the loaded index', async () => {
		render(<TargetsProbe />);

		await act(async () => {
			connectionHandler?.({ status: 'connected', vaultDns: 'acme.veevavault.com', isProduction: false });
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(screen.getByTestId('targets')).toHaveTextContent('1');

		// Switching to a different Vault resets the index and re-warms it; the second warm returns 2
		// targets, so the observed count changing 1 → 2 proves the reset + re-warm re-rendered React.
		await act(async () => {
			connectionHandler?.({ status: 'connected', vaultDns: 'other.veevavault.com', isProduction: false });
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(screen.getByTestId('targets')).toHaveTextContent('2');
	});
});
