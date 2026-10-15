import * as vscode from 'vscode';

/**
 * Read a `vaultToolbox.*` setting. Several of our keys (`MDLDirectory`, `APIVersion`,
 * `VQLMaxExportRows`, …) use all-caps casing for their acronym instead of our
 * usual camelCase. VS Code derives the Settings UI label from the key, and only an all-caps run
 * renders as the acronym — e.g. `MDLDirectory` renders as "MDL Directory", where the camelCase
 * `mdlDirectory` would mangle to "Mdl Directory". Don't rename these keys for casing consistency —
 * that would silently orphan users' saved values. Every read of one of these keys must go through
 * here so the casing stays centralized in one place.
 */
export function getVaultToolboxSetting<T>(key: string): T | undefined;
export function getVaultToolboxSetting<T>(key: string, defaultValue: T): T;
export function getVaultToolboxSetting<T>(key: string, defaultValue?: T): T | undefined {
	return vscode.workspace.getConfiguration('vaultToolbox').get<T>(key, defaultValue as T);
}
