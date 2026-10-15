import type { QueryRow } from '../rest/types';

/**
 * Pure planning for "Extract MDL from Vault": turn `vault_component__v` query rows into the files
 * to write, and compute which local files are now orphaned. Kept vscode-free and fs-free so the 
 * file layout and the destructive mirror-delete are unit-testable in isolation; the host task does
 * the actual I/O.
 */

/** One MDL file to write, located by path segments relative to the per-vault extract root. */
export interface MdlFile {
	/** e.g. `['Picklist', 'Picklist.color__c.mdl']` — a per-component-type subfolder, then the file. */
	segments: string[];
	content: string;
}

/** Vault's sentinel for a component that has no retrievable MDL; such rows are skipped. */
const NO_MDL_DEFINITION = 'N/A';

/**
 * Plan the files for a page (or all pages) of component rows. Each row with a real MDL definition
 * becomes `<ComponentType>/<ComponentType>.<component_name>.mdl`; rows missing a field, or whose
 * definition is Vault's `N/A` sentinel, are skipped.
 */
export function planMdlFiles(rows: readonly QueryRow[]): MdlFile[] {
	const files: MdlFile[] = [];
	for (const row of rows) {
		const componentType = asNonEmptyString(row['component_type__v']);
		const componentName = asNonEmptyString(row['component_name__v']);
		const mdlDefinition = asNonEmptyString(row['mdl_definition__v']);
		if (!componentType || !componentName || !mdlDefinition || mdlDefinition === NO_MDL_DEFINITION) {
			continue;
		}
		files.push({
			segments: [componentType, `${componentType}.${componentName}.mdl`],
			content: mdlDefinition,
		});
	}
	return files;
}

/** The file's path relative to the extract root, always forward-slashed for stable comparison. */
export function relativeMdlPath(file: MdlFile): string {
	return file.segments.join('/');
}

/**
 * The local files to delete so the extract folder mirrors Vault: those present before extraction that
 * weren't written this time. Both lists are forward-slashed paths relative to the extract root.
 */
export function orphanedMdlFiles(existing: string[], written: string[]): string[] {
	const writtenSet = new Set(written);
	return existing.filter((path) => !writtenSet.has(path));
}

/** Return the value as a trimmed non-empty string, or undefined when absent/blank/not a string. */
function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
