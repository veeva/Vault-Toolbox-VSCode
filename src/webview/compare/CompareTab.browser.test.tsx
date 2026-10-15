import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthType } from '../../core/models/environment';
import type { EnvironmentRow } from '../../shared/environmentsProtocol';
import type { CompareSessionState } from '../../shared/compareProtocol';
import { dispatchEnvelope, postMessageSpy } from '../test/setup';
import { CompareTab } from './CompareTab';

/**
 * Two facts this tab can only learn from the host: which entries are checked in the native Compare tree
 * (the **Apply Selected to Target** button is gated on it) and which comparison is live (none of this
 * tab's own state survives a webview rebuild). These pin both halves of that contract — the tab
 * announcing itself on mount, and what it does with what comes back.
 */
function env(id: string, label: string, isActive = false): EnvironmentRow {
	return {
		id,
		label,
		vaultDNS: `${id}.veevavault.com`,
		authType: AuthType.Basic,
		status: 'disconnected',
		isActive,
		isProduction: false,
	};
}

/** The host's environments snapshot. `activeId` is the one the tab defaults its source to, once. */
function pushEnvironments(activeId?: string): void {
	act(() => {
		dispatchEnvelope('environments', {
			type: 'snapshot',
			snapshot: {
				environments: [
					env('src', 'Source Vault', activeId === 'src'),
					env('tgt', 'Target Vault', activeId === 'tgt'),
					env('other', 'Other Vault', activeId === 'other'),
				],
			},
		});
	});
}

/** One labelled select, as the row that holds both its caption and its selected value. */
function field(label: string): HTMLElement | null {
	return screen.getByText(label).closest('.vt-compare-field');
}

function pushSessionState(session?: CompareSessionState): void {
	act(() => {
		dispatchEnvelope('compareEnvironments', { type: 'sessionState', session });
	});
}

function pushSelection(hasSelection: boolean): void {
	act(() => {
		dispatchEnvelope('compareEnvironments', { type: 'selectionChanged', hasSelection });
	});
}

describe('CompareTab host-state contract', () => {
	it('announces readiness on the compare channel when it mounts', () => {
		render(<CompareTab />);

		expect(postMessageSpy).toHaveBeenCalledWith({
			channel: 'compareEnvironments',
			message: { type: 'ready' },
		});
	});

	it('enables Apply Selected when the host pushes a selection', async () => {
		render(<CompareTab />);
		pushEnvironments();
		await userEvent.click(screen.getByLabelText('Enable Apply to Target Vault'));

		pushSelection(true);

		expect(screen.getByRole('button', { name: /Apply Selected/ })).toBeEnabled();
	});

	it('disables Apply Selected again when the host pushes an empty selection', async () => {
		render(<CompareTab />);
		pushEnvironments();
		await userEvent.click(screen.getByLabelText('Enable Apply to Target Vault'));
		pushSelection(true);

		pushSelection(false);

		expect(screen.getByRole('button', { name: /Apply Selected/ })).toBeDisabled();
	});

	it('rehydrates from the host\'s live comparison, so a rebuilt webview is not an empty form', () => {
		render(<CompareTab />);
		pushEnvironments();

		pushSessionState({
			sourceId: 'src',
			targetId: 'tgt',
			kinds: { mdl: false, code: true },
			applyEnabled: true,
		});

		// Locked controls and "New Compare" mean the tab knows it is attached to a live comparison.
		expect(screen.getByRole('button', { name: 'New Compare' })).toBeInTheDocument();
		expect(screen.getByLabelText('Enable Apply to Target Vault')).toBeChecked();
		expect(screen.getByLabelText('Components (MDL)')).not.toBeChecked();
		expect(screen.getByLabelText('Code (Vault Java SDK)')).toBeChecked();
	});

	it('restores the compared pair', () => {
		render(<CompareTab />);
		pushEnvironments();

		pushSessionState({
			sourceId: 'src',
			targetId: 'tgt',
			kinds: { mdl: true, code: true },
			applyEnabled: false,
		});

		expect(field('Source (pull from)')).toHaveTextContent('Source Vault');
		expect(field('Target (apply to)')).toHaveTextContent('Target Vault');
	});

	it('keeps the restored source when the environments snapshot lands after it', () => {
		render(<CompareTab />);

		// The restore wins the race, then the snapshot arrives wanting to default the source to the
		// active environment — a different Vault than the one this comparison ran from.
		pushSessionState({
			sourceId: 'src',
			targetId: 'tgt',
			kinds: { mdl: true, code: true },
			applyEnabled: false,
		});
		pushEnvironments('other');

		expect(field('Source (pull from)')).toHaveTextContent('Source Vault');
	});

	it('defaults the source to the active environment when there is no comparison to restore', () => {
		render(<CompareTab />);

		pushSessionState(undefined);
		pushEnvironments('other');

		expect(field('Source (pull from)')).toHaveTextContent('Other Vault');
	});

	it('keeps an Apply tick made before Generate when the host announces the new comparison', async () => {
		render(<CompareTab />);
		pushEnvironments('src');
		await userEvent.click(screen.getByLabelText('Enable Apply to Target Vault'));
		await userEvent.click(screen.getByLabelText('Target (apply to)'));
		await userEvent.click(screen.getByText('Target Vault'));
		await userEvent.click(screen.getByRole('button', { name: 'Generate Compare' }));

		// The host's brand-new session is apply-disabled by construction; adopting it here would clear
		// the tick the user made moments ago, which the result handler is about to carry over.
		pushSessionState({
			sourceId: 'src',
			targetId: 'tgt',
			kinds: { mdl: true, code: true },
			applyEnabled: false,
		});

		expect(screen.getByLabelText('Enable Apply to Target Vault')).toBeChecked();
	});

	it('stays unlocked when the host reports no comparison', () => {
		render(<CompareTab />);
		pushEnvironments();

		pushSessionState(undefined);

		expect(screen.getByRole('button', { name: 'Generate Compare' })).toBeInTheDocument();
	});
});
