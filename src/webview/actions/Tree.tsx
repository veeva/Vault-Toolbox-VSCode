import type { TreeNode } from './treeModel';
import { TreeItem } from './TreeItem';

interface TreeProps {
	nodes: TreeNode[];
}

/** Renders a list of top-level {@link TreeNode}s; each row manages its own expand state. */
export function Tree({ nodes }: TreeProps): JSX.Element {
	return (
		<div className="vt-tree" role="tree">
			{nodes.map((node) => (
				<TreeItem key={node.id} node={node} depth={0} />
			))}
		</div>
	);
}
