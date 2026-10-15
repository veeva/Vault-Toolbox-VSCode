import * as vscode from 'vscode';
import type { EnvironmentFormSubmit } from '../../shared/environmentsProtocol';
import type { EnvironmentActions } from '../webview/environmentsBus';
import { mapFormSubmit } from './environmentForm';
import type { EnvironmentService } from './environmentService';

/**
 * The vscode-coupled environment actions: `EnvironmentService` calls wrapped in the native UX
 * (connect progress, confirm-on-remove, success/error toasts). This is the shared helper layer the
 * Environments tab's {@link EnvironmentActions} contract needs; the palette commands adopt the same
 * helpers at cutover so both entry points share one copy of the dialog logic.
 */
export function createEnvironmentActions(service: EnvironmentService): EnvironmentActions {
	return {
		connect: (id) => connect(service, id),
		disconnect: async (id) => {
			const env = service.get(id);
			await service.disconnect(id);
			void vscode.window.showInformationMessage(`Disconnected from ${env?.label ?? 'Vault'}.`);
		},
		setActive: async (id) => {
			try {
				await service.setActive(id);
				const env = service.get(id);
				if (env) {
					void vscode.window.showInformationMessage(`"${env.label}" is now the active environment.`);
				}
			} catch (e) {
				void vscode.window.showErrorMessage(
					`Vault Toolbox: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		},
		remove: (id) => remove(service, id),
		openVault: async (id) => {
			const env = service.get(id);
			if (!env) {
				return;
			}
			await vscode.env.openExternal(vscode.Uri.parse(`https://${env.vaultDNS}/`));
		},
		submitForm: (submit) => submitForm(service, submit),
	};
}

/**
 * Connect with a progress notification and report success/failure (ports the command's
 * `connectById`). This is the manual, user-driven connect path (Environments tab row + palette
 * command), so it always takes over active — unlike Compare's on-demand connect, which must not.
 */
async function connect(service: EnvironmentService, id: string): Promise<void> {
	const env = service.get(id);
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Connecting to ${env?.vaultDNS ?? 'Vault'}…`,
		},
		async () => {
			try {
				const info = await service.connect(id, { makeActive: true });
				const vaultName = info.vaultName ?? env?.label ?? 'Vault';
				void vscode.window.showInformationMessage(`Vault Toolbox: Connected to ${vaultName}`);
			} catch (e) {
				void vscode.window.showErrorMessage(
					`Vault Toolbox: connection failed — ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		},
	);
}

/** Confirm (destructive) then remove the environment and its secret. No-op if the user declines. */
async function remove(service: EnvironmentService, id: string): Promise<void> {
	const env = service.get(id);
	if (!env) {
		return;
	}
	const choice = await vscode.window.showWarningMessage(
		`Remove environment "${env.label}"? Its saved secret will be deleted.`,
		{ modal: true },
		'Remove',
	);
	if (choice !== 'Remove') {
		return;
	}
	await service.remove(id);
	void vscode.window.showInformationMessage(`Removed environment "${env.label}".`);
}

/**
 * Resolve the `existingLabel` fallback passed to {@link mapFormSubmit} when the edit form's label
 * field is blank.
 *
 * - Auto-adopted label (not custom, already replaced the DNS placeholder) → preserve it.
 * - Custom label being cleared → use the live Vault name if connected, so the field can be wiped
 *   without losing a known-good name; falls back to undefined so auto-adopt picks it up on the
 *   next connect if the environment has never been connected.
 * - DNS placeholder was never replaced (environment was never connected) → undefined; the caller
 *   re-seeds from the new DNS.
 */
function resolveEditLabelFallback(
	service: EnvironmentService,
	id: string,
	existing: ReturnType<EnvironmentService['get']>,
): string | undefined {
	if (!existing) {
		return undefined;
	}
	if (!existing.hasCustomLabel && existing.label !== existing.vaultDNS) {
		return existing.label;
	}
	if (existing.hasCustomLabel) {
		return service.getConnectedVaultName(id);
	}
	return undefined;
}

/** Add or update an environment from a form submission, reporting the outcome. */
async function submitForm(
	service: EnvironmentService,
	submit: EnvironmentFormSubmit,
): Promise<void> {
	if (submit.mode === 'edit' && submit.id) {
		const existing = service.get(submit.id);
		const { input, secret } = mapFormSubmit(submit, resolveEditLabelFallback(service, submit.id, existing));
		const updated = await service.edit(submit.id, input, secret);
		void vscode.window.showInformationMessage(`Updated environment "${updated.label}".`);
		return;
	}
	const { input, secret } = mapFormSubmit(submit, undefined);
	const env = await service.add(input, secret ?? '');
	void vscode.window.showInformationMessage(`Added environment "${env.label}".`);
}
