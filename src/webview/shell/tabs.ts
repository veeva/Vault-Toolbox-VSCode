import type { ShellTab } from '../../shared/shellProtocol';

/** The feature tabs the unified sidebar can show. Extended as new features land. */
export type TabId = ShellTab;

/** Display metadata for one tab in the icon-only tab bar (Decision: icon-only + tooltip). */
export interface TabMeta {
	id: TabId;
	/** Tooltip + accessible name (the tab shows only its icon). */
	label: string;
	icon: JSX.Element;
}
