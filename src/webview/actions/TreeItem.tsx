import { useLayoutEffect, useRef, useState } from 'react';
import type { TreeNode } from './treeModel';

interface TreeItemProps {
	node: TreeNode;
	depth: number;
}

/** Twisty for parent rows; rotates from ▸ (collapsed) to ▾ (expanded) via the `expanded` class. */
function Chevron({ expanded }: { expanded: boolean }): JSX.Element {
	return (
		<svg
			className={`vt-tree-chevron${expanded ? ' expanded' : ''}`}
			width="12"
			height="12"
			viewBox="0 0 16 16"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M6 4l4 4-4 4V4z" />
		</svg>
	);
}

const TREE_BASE_PADDING_PX = 8;
const TREE_INDENT_PER_DEPTH_PX = 14;

/** Left padding that steps in one level per depth, leaving room for the chevron column. */
function indentStyle(depth: number): { paddingLeft: string } {
	return { paddingLeft: `${TREE_BASE_PADDING_PX + depth * TREE_INDENT_PER_DEPTH_PX}px` };
}

/**
 * Tracks whether the referenced label element is ellipsis-truncated, re-measuring as the panel
 * resizes so the full-label tooltip appears only when the text doesn't fit.
 */
function useLabelTruncation(): { ref: React.RefObject<HTMLSpanElement>; isTruncated: boolean } {
	const ref = useRef<HTMLSpanElement>(null);
	const [isTruncated, setIsTruncated] = useState(false);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		const measure = (): void => setIsTruncated(element.scrollWidth > element.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return { ref, isTruncated };
}

/**
 * One node of the Actions tree. A parent row toggles its own expand state on click and renders its
 * children when expanded; a leaf row fires its action unless disabled, in which case it renders
 * greyed-out with an explanatory tooltip. Recurses for nested parents. A row whose label is too
 * narrow to fit surfaces the full label as a tooltip; a disabled leaf's gating tooltip takes priority.
 */
export function TreeItem({ node, depth }: TreeItemProps): JSX.Element {
	const isParent = node.children !== undefined;
	const [expanded, setExpanded] = useState(true);
	const { ref: labelRef, isTruncated } = useLabelTruncation();
	const labelTooltip = isTruncated ? node.label : undefined;

	if (isParent) {
		return (
			<>
				<button
					type="button"
					className="vt-tree-row"
					style={indentStyle(depth)}
					aria-expanded={expanded}
					data-tooltip={labelTooltip}
					data-tooltip-dir="below"
					data-tooltip-align="left"
					data-tooltip-wrap
					onClick={() => setExpanded((value) => !value)}
				>
					<Chevron expanded={expanded} />
					{node.icon}
					<span ref={labelRef} className="vt-tree-label">
						{node.label}
					</span>
				</button>
				{expanded &&
					node.children?.map((child) => <TreeItem key={child.id} node={child} depth={depth + 1} />)}
			</>
		);
	}

	// A native `disabled` button suppresses hover events, which would hide the gating tooltip — so gate
	// with `aria-disabled` + a class and guard the click, keeping the row hoverable.
	return (
		<button
			type="button"
			className={`vt-tree-row vt-tree-leaf${node.disabled ? ' disabled' : ''}`}
			style={indentStyle(depth)}
			aria-disabled={node.disabled}
			data-tooltip={node.disabled ? node.disabledTooltip : labelTooltip}
			data-tooltip-dir="below"
			data-tooltip-align="left"
			data-tooltip-wrap
			onClick={node.disabled ? undefined : node.onClick}
		>
			<span className="vt-tree-chevron-spacer" aria-hidden="true" />
			{node.icon}
			<span ref={labelRef} className="vt-tree-label">
				{node.label}
			</span>
		</button>
	);
}
