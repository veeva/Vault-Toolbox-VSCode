/**
 * Pure construction of a `DROP` statement from an MDL file's body. Dropping a component reuses the MDL
 * Execute endpoint, but instead of sending the file's `CREATE`/`RECREATE` definition we send a single
 * `DROP <ComponentType> <ComponentName>;` — e.g. `DROP Object custom__c;` or
 * `DROP Atomicsecurity trained_model__sys.trained_model_lifecycle__sys.archived_state__sys.atomic_security__sys;`.
 * The type and name are read from the leading statement's header, which every extracted `.mdl` file
 * begins with (`RECREATE Picklist color__c (...)`), so we drop exactly the tokens Vault used to name
 * the component. Kept vscode-free so the parse is unit-testable in isolation.
 */

/** The component a `DROP` targets, plus the ready-to-send statement. */
export interface MdlDropTarget {
	componentType: string;
	componentName: string;
	statement: string;
}

/** A parsed drop, or a human-readable reason the body couldn't be read as a component definition. */
export type MdlDropParse = { ok: true; target: MdlDropTarget } | { ok: false; error: string };

/**
 * The header every extracted definition begins with: a verb, the component type, then the component
 * name. The name is captured verbatim up to whitespace, `(`, or `;`, so dotted Atomic Security names
 * survive intact.
 */
const MDL_HEADER = /^\s*(?:CREATE|RECREATE|ALTER|RENAME|DROP)\s+([A-Za-z]\w*)\s+([^\s(;]+)/i;

/**
 * Build the `DROP <ComponentType> <ComponentName>;` statement for an MDL body, or return an error when
 * the body doesn't begin with a recognizable `<verb> <Type> <Name>` header (e.g. an empty file or a
 * comment-only stub).
 */
export function buildMdlDropStatement(mdlBody: string): MdlDropParse {
	const match = MDL_HEADER.exec(mdlBody);
	if (!match) {
		return {
			ok: false,
			error:
				'Could not read a component type and name from this .mdl file. Its first statement must ' +
				'begin with a component definition, e.g. `RECREATE Object custom__c (...)`.',
		};
	}
	const [, componentType, componentName] = match;
	return {
		ok: true,
		target: {
			componentType,
			componentName,
			statement: `DROP ${componentType} ${componentName};`,
		},
	};
}
