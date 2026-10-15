import { describe, it, expect, vi } from 'vitest';

// `getChildren` is pure; only `getTreeItem` touches vscode. Stub the module so it loads under node.
vi.mock('vscode', () => ({
	EventEmitter: class {
		event = () => {};
		fire(): void {}
	},
}));

import { CompareTreeProvider, type CompareNode } from './compareTree';
import { CompareSession } from './compareSession';
import type { ComponentDefinition, CodeClass } from '../../core/compare/compareComponents';

/**
 * Data-path invariant for the Vault Compare tree. The reported bug — an MDL component
 * (`my_context_type__c`) ghosting under the "Code (Vault Java SDK)" node — was a VS Code renderer
 * artifact (fixed by a warm repaint in the controller), NOT the data path. These tests pin the reason
 * the data path is innocent: the Code node's children come only from `kind: 'code'` entries, so no view
 * state or grouping change can ever surface an MDL entry there. If a future refactor breaks that
 * `kind`-filtering, this goes red — turning the render-only ghost into a real, catchable data bug.
 */
describe('Compare tree data path: kinds never cross between sections', () => {
	const mdlTarget: ComponentDefinition[] = [
		{ type: 'Aicontexttype', name: 'my_context_type__c', mdl: 'RECREATE Aicontexttype my_context_type__c();' },
	];
	const codeSource: CodeClass[] = [
		{ name: 'com.veeva.vault.custom.triggers.Foo', source: 'class Foo {}' },
		{ name: 'com.veeva.vault.custom.actions.Bar', source: 'class Bar {}' },
	];
	const codeTarget: CodeClass[] = [{ name: 'com.veeva.vault.custom.triggers.Foo', source: 'class Foo { int x; }' }];

	const session = new CompareSession({
		source: { envId: 's', vaultDNS: 'src.veevavault.com', label: 'src' },
		target: { envId: 't', vaultDNS: 'tgt.veevavault.com', label: 'tgt' },
		targetIsProduction: false,
		mdl: { source: [], target: mdlTarget },
		code: { source: codeSource, target: codeTarget },
	});
	const tree = new CompareTreeProvider(() => session);
	const codeRoot: CompareNode = { kind: 'kindRoot', compareKind: 'code' };
	const mdlRoot: CompareNode = { kind: 'kindRoot', compareKind: 'mdl' };

	const entryNames = (nodes: CompareNode[]): string[] =>
		nodes.flatMap((node) => (node.kind === 'entry' ? [node.entry.name] : []));

	it('emits no entry rows (only package nodes) directly under the Code node', () => {
		const codeChildren = tree.getChildren(codeRoot);
		expect(entryNames(codeChildren)).toEqual([]);
		expect(codeChildren.length).toBeGreaterThan(0);
		expect(codeChildren.every((node) => node.kind === 'package')).toBe(true);
	});

	it('never surfaces the MDL component anywhere under the Code node', () => {
		const underCode = (prefix: CompareNode): string[] => {
			const children = tree.getChildren(prefix);
			return [
				...entryNames(children),
				...children.filter((node) => node.kind === 'package').flatMap((pkg) => underCode(pkg)),
			];
		};
		expect(underCode(codeRoot)).not.toContain('my_context_type__c');
	});

	it('surfaces the MDL component only under its Aicontexttype group in the MDL node', () => {
		const aiGroup = tree.getChildren(mdlRoot).find((node) => node.kind === 'type' && node.type === 'Aicontexttype');
		expect(aiGroup).toBeDefined();
		expect(entryNames(tree.getChildren(aiGroup!))).toContain('my_context_type__c');
	});
});
