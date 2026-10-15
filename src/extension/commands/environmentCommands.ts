import * as vscode from 'vscode';
import type { Environment } from '../../core/models/environment';
import type { EnvironmentService } from '../environments/environmentService';
import type { EnvironmentActions } from '../webview/environmentsBus';
import type { ShellViewProvider } from '../webview/shellViewProvider';

/**
 * Registers the environment palette commands. They share the same {@link EnvironmentActions} the
 * Environments tab drives (one copy of the connect-progress / confirm / toast logic); the add form is
 * reached by focusing the shell and navigating to the add screen. Editing is a per-row action in the
 * list, so it has no palette entry.
 */
export function registerEnvironmentCommands(
	service: EnvironmentService,
	actions: EnvironmentActions,
	shell: ShellViewProvider,
): vscode.Disposable[] {
	const on = (command: string, handler: () => void | Promise<void>) =>
		vscode.commands.registerCommand(command, handler);

	const withPick = async (
		placeHolder: string,
		run: (env: Environment) => Promise<void>,
		filter?: (env: Environment) => boolean,
	) => {
		const env = await resolveEnvironment(service, placeHolder, filter);
		if (env) {
			await run(env);
		}
	};

	return [
		on('vaultToolbox.addEnvironment', () => shell.revealTab('environments', 'add')),
		on('vaultToolbox.connectEnvironment', () =>
			withPick('Select an environment to connect', (env) => actions.connect(env.id)),
		),
		on('vaultToolbox.disconnect', () =>
			withPick(
				'Select a connected environment to disconnect',
				(env) => actions.disconnect(env.id),
				(env) => service.isConnected(env.id),
			),
		),
		on('vaultToolbox.setActiveEnvironment', () =>
			withPick(
				'Select the active environment',
				(env) => actions.setActive(env.id),
				(env) => service.isConnected(env.id),
			),
		),
		on('vaultToolbox.removeEnvironment', () =>
			withPick('Select an environment to remove', (env) => actions.remove(env.id)),
		),
	];
}

/** Pick a target environment from a QuickPick over the saved environments matching `filter`. */
async function resolveEnvironment(
	service: EnvironmentService,
	placeHolder: string,
	filter?: (env: Environment) => boolean,
): Promise<Environment | undefined> {
	const envs = service.list().filter((env) => filter?.(env) ?? true);
	if (envs.length === 0) {
		void vscode.window.showInformationMessage(
			filter ? 'No connected environments.' : 'No environments yet. Add one first.',
		);
		return undefined;
	}
	const activeId = service.getActiveId();
	const pick = await vscode.window.showQuickPick(
		envs.map((env) => ({
			label: env.id === activeId ? `$(star-full) ${env.label}` : env.label,
			description: env.vaultDNS,
			env,
		})),
		{ placeHolder, ignoreFocusOut: true },
	);
	return pick?.env;
}
