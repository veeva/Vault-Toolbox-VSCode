import { useCallback, useEffect, useState } from 'react';
import { ActionsPanel } from '../actions/ActionsPanel';
import { ApiHistoryTab } from '../api-history/ApiHistoryTab';
import { CompareTab } from '../compare/CompareTab';
import { EnvironmentsPanel } from '../environments/EnvironmentsPanel';
import { getWebviewState, setWebviewState } from '../vscodeApi';
import { TabBar } from './TabBar';
import { VqlTab } from './VqlTab';
import {
	ActionsIcon,
	ApiHistoryIcon,
	CompareEnvironmentsIcon,
	EnvironmentsIcon,
	VqlIcon,
} from './icons';
import {
	announceShellReady,
	getPanelTab,
	getSurface,
	onNavigate,
	onPoppedOut,
	requestOpenSettings,
} from './shellClient';
import type { TabId, TabMeta } from './tabs';
import type { PopOutTab } from '../../shared/shellProtocol';

interface TabDef extends TabMeta {
	render(poppedOut: boolean): JSX.Element;
}

const SURFACE = getSurface();

/**
 * Registered tabs, in display order. The first entry is the default tab the shell opens on the very
 * first load (before any tab is persisted) — Environments, since VQL is useless until connected.
 */
const TABS: TabDef[] = [
	{
		id: 'environments',
		label: 'Environments',
		icon: <EnvironmentsIcon />,
		render: () => <EnvironmentsPanel />,
	},
	{
		id: 'vql',
		label: 'VQL Editor',
		icon: <VqlIcon />,
		render: (poppedOut) => <VqlTab surface={SURFACE} poppedOut={poppedOut} />,
	},
	{
		id: 'compareEnvironments',
		label: 'Compare Environments',
		icon: <CompareEnvironmentsIcon />,
		render: () => <CompareTab />,
	},
	{
		id: 'actions',
		label: 'Actions',
		icon: <ActionsIcon />,
		render: () => <ActionsPanel />,
	},
	{
		id: 'apiHistory',
		label: 'API History',
		icon: <ApiHistoryIcon />,
		render: (poppedOut) => <ApiHistoryTab surface={SURFACE} poppedOut={poppedOut} />,
	},
];

// A popped-out panel hosts exactly the one tab the host stamped it with; the sidebar shows them all.
const VISIBLE_TABS = SURFACE === 'panel' ? TABS.filter((tab) => tab.id === getPanelTab()) : TABS;

interface ShellState {
	activeTab: TabId;
}

/** The persisted tab if it's still a visible tab, else the default (first visible) tab. */
function initialTab(): TabId {
	const saved = getWebviewState<ShellState>()?.activeTab;
	return VISIBLE_TABS.some((tab) => tab.id === saved) ? (saved as TabId) : VISIBLE_TABS[0].id;
}

/**
 * The unified sidebar shell: an icon-only tab bar over the active feature panel. Every tab stays
 * mounted (inactive ones hidden) so switching preserves each feature's in-flight state. The host can
 * drive navigation (palette commands) and reports when a poppable tab (VQL, API History) is popped
 * out so its tab shows a placeholder. The active tab is remembered across reloads via the webview's
 * persisted state.
 */
export function TabShell(): JSX.Element {
	const [activeTab, setActiveTab] = useState<TabId>(initialTab);
	const [poppedOut, setPoppedOut] = useState<Record<PopOutTab, boolean>>({
		vql: false,
		apiHistory: false,
	});

	const selectTab = useCallback((id: TabId) => {
		setActiveTab(id);
		setWebviewState<ShellState>({ activeTab: id });
	}, []);

	useEffect(() => {
		const offNavigate = onNavigate((tab) => selectTab(tab));
		const offPoppedOut = onPoppedOut((tab, value) =>
			setPoppedOut((current) => ({ ...current, [tab]: value })),
		);
		announceShellReady();
		return () => {
			offNavigate();
			offPoppedOut();
		};
	}, [selectTab]);

	return (
		<div className="vt-shell">
			{VISIBLE_TABS.length > 1 && (
				<TabBar
					tabs={VISIBLE_TABS}
					activeTab={activeTab}
					onSelect={selectTab}
					onSettings={requestOpenSettings}
				/>
			)}
			{VISIBLE_TABS.map((tab) => (
				<div key={tab.id} className="vt-tabpanel" role="tabpanel" hidden={tab.id !== activeTab}>
					{tab.render(poppedOut[tab.id as PopOutTab] ?? false)}
				</div>
			))}
		</div>
	);
}
