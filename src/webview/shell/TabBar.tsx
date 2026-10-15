import { GearIcon } from './icons';
import type { TabId, TabMeta } from './tabs';

interface TabBarProps {
	tabs: TabMeta[];
	activeTab: TabId;
	onSelect(id: TabId): void;
	onSettings?(): void;
}

/**
 * Icon-only tab strip across the top of the sidebar shell: one icon per feature, active tab
 * underlined, the label surfaced as a tooltip + accessible name. When `onSettings` is provided, a
 * gear button is pushed to the far right of the strip.
 */
export function TabBar({ tabs, activeTab, onSelect, onSettings }: TabBarProps): JSX.Element {
	return (
		<div className="vt-tabbar" role="tablist">
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					role="tab"
					aria-selected={tab.id === activeTab}
					aria-label={tab.label}
					data-tooltip={tab.label}
					data-tooltip-dir="below"
					className={`vt-tab${tab.id === activeTab ? ' active' : ''}`}
					onClick={() => onSelect(tab.id)}
				>
					{tab.icon}
				</button>
			))}
			{onSettings && (
				<button
					type="button"
					aria-label="Settings"
					data-tooltip="Settings"
					data-tooltip-dir="below"
					className="vt-tab vt-tab--settings"
					onClick={onSettings}
				>
					<GearIcon />
				</button>
			)}
		</div>
	);
}
