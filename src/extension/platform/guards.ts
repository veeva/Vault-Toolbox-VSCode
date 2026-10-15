import * as vscode from 'vscode';
import { isProductionVault } from '../../core/production';

/**
 * Shows a blocking modal error if the connected environment is a Production Vault, then returns
 * `true` so the caller can `return` immediately. Returns `false` when the environment is not
 * Production and the operation may proceed.
 *
 * Centralises the Production guard that every destructive operation must apply (MDL Execute,
 * SDK code deploy/delete, and future VPK Deploy). Callers pass the human-readable action label
 * and per-operation detail copy; this owns the `isProductionVault` call and the modal mechanics.
 *
 * @param domainType  - The Domain Type of the connected Vault (`state.info.domain?.domainType`).
 * @param vaultDNS    - The Vault DNS of the connected Vault (`state.info.environment.vaultDNS`).
 * @param actionLabel - Verb phrase used in the blocking title, e.g. `'Deploy to Vault'`. The modal
 *                      title is `"${actionLabel} is blocked on a Production Vault."`.
 * @param detail      - Per-operation explanation shown in the modal detail area.
 */
export async function guardProductionVault(
	domainType: string | undefined,
	vaultDNS: string,
	actionLabel: string,
	detail: string,
): Promise<boolean> {
	if (!isProductionVault(domainType, vaultDNS)) {
		return false;
	}
	await vscode.window.showErrorMessage(
		`${actionLabel} is blocked on a Production Vault.`,
		{ modal: true, detail },
	);
	return true;
}
