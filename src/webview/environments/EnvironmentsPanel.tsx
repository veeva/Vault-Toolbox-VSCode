import { useEffect, useState } from 'react';
import type { EnvironmentFormSubmit, EnvironmentRow } from '../../shared/environmentsProtocol';
import { onNavigate } from '../shell/shellClient';
import {
	connectEnvironment,
	disconnectEnvironment,
	onEnvironmentsReveal,
	onEnvironmentsSnapshot,
	openVaultEnvironment,
	removeEnvironment,
	requestEnvironments,
	setActiveEnvironment,
	submitEnvironmentForm,
} from './environmentsClient';
import { EnvironmentForm } from './EnvironmentForm';
import { EnvironmentList } from './EnvironmentList';

/** The list view, or the add/edit form sub-screen (Decision: the form lives inside this tab). */
type Screen = { name: 'list' } | { name: 'add' } | { name: 'edit'; env: EnvironmentRow };

/**
 * The Environments tab: subscribes to the host-pushed snapshot and routes between the environment
 * list and the add/edit form. Submitting or cancelling the form returns to the list; the host
 * re-pushes the snapshot after a submit, so the list reflects the change without extra plumbing.
 */
export function EnvironmentsPanel(): JSX.Element {
	const [environments, setEnvironments] = useState<EnvironmentRow[]>([]);
	const [screen, setScreen] = useState<Screen>({ name: 'list' });
	// Bumped on every host-pushed reveal so the current environment's Vault info section can be
	// force-reopened even if the user had manually collapsed it; undefined until the first reveal.
	const [revealNonce, setRevealNonce] = useState<number | undefined>(undefined);

	useEffect(() => {
		const offSnapshot = onEnvironmentsSnapshot((snapshot) =>
			setEnvironments(snapshot.environments),
		);
		// The status bar click lands here: snap back to the list (in case a form was open) and reveal.
		const offReveal = onEnvironmentsReveal(() => {
			setScreen({ name: 'list' });
			setRevealNonce((nonce) => (nonce ?? 0) + 1);
		});
		// Palette "Add Environment" navigates here with the add screen.
		const offNavigate = onNavigate((tab, target) => {
			if (tab === 'environments' && target === 'add') {
				setScreen({ name: 'add' });
			}
		});
		requestEnvironments();
		return () => {
			offSnapshot();
			offReveal();
			offNavigate();
		};
	}, []);

	function handleSubmit(submit: EnvironmentFormSubmit): void {
		submitEnvironmentForm(submit);
		setScreen({ name: 'list' });
	}

	if (screen.name !== 'list') {
		return (
			<div className="vt-env-panel">
				<EnvironmentForm
					editing={screen.name === 'edit' ? screen.env : undefined}
					onSubmit={handleSubmit}
					onCancel={() => setScreen({ name: 'list' })}
				/>
			</div>
		);
	}

	return (
		<div className="vt-env-panel">
			<EnvironmentList
				environments={environments}
				revealNonce={revealNonce}
				onAdd={() => setScreen({ name: 'add' })}
				onConnect={connectEnvironment}
				onDisconnect={disconnectEnvironment}
				onSetActive={setActiveEnvironment}
				onEdit={(env) => setScreen({ name: 'edit', env })}
				onRemove={removeEnvironment}
				onOpenVault={openVaultEnvironment}
			/>
		</div>
	);
}
