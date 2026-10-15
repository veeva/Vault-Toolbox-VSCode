import type { PopOutTab } from '../../shared/shellProtocol';
import type { HostToWebviewMessage } from '../../shared/vqlProtocol';

/** A live VQL surface that can receive host-pushed query messages; `ShellHost` satisfies it. */
export interface VqlSurfaceHost {
	postVql(message: HostToWebviewMessage): void;
}

/** A live API History surface that can be told to reveal a specific entry; `ShellHost` satisfies it. */
export interface ApiHistorySurfaceHost {
	revealApiHistoryEntry(id: string): void;
}

/** A live Environments surface that can be told to expand the current environment's Vault info; `ShellHost` satisfies it. */
export interface EnvironmentsSurfaceHost {
	revealEnvironmentInfo(): void;
}

/** The capabilities a shell surface exposes to host-side reveal/push; `ShellHost` satisfies it. */
export type ShellSurfaceHost = VqlSurfaceHost & ApiHistorySurfaceHost & EnvironmentsSurfaceHost;

/**
 * Tracks the live sidebar and popped-out-panel shell surfaces so host-side code can push to (VQL) or
 * reveal within (API History) whichever surface is currently in front of the user. For each poppable
 * tab the panel takes priority when open, matching how a human's action always lands on the surface
 * they're looking at.
 */
export class ShellSurfaceRegistry {
	private sidebar?: ShellSurfaceHost;
	private readonly panels = new Map<PopOutTab, ShellSurfaceHost>();

	registerSidebar(host: ShellSurfaceHost): void {
		this.sidebar = host;
	}

	/** Clear the sidebar registration, but only if `host` is still the one registered (guards a stale
	 *  dispose racing a newer resolve). */
	unregisterSidebar(host: ShellSurfaceHost): void {
		if (this.sidebar === host) {
			this.sidebar = undefined;
		}
	}

	registerPanel(tab: PopOutTab, host: ShellSurfaceHost): void {
		this.panels.set(tab, host);
	}

	/** Clear a panel registration, but only if `host` is still the one registered for `tab` (guards a
	 *  stale dispose racing a newer resolve). */
	unregisterPanel(tab: PopOutTab, host: ShellSurfaceHost): void {
		if (this.panels.get(tab) === host) {
			this.panels.delete(tab);
		}
	}

	/** The API History panel if open, else the sidebar — where a reveal should land. */
	activeApiHistoryTarget(): ApiHistorySurfaceHost | undefined {
		return this.panels.get('apiHistory') ?? this.sidebar;
	}

	/** Environments is never poppable (not a `PopOutTab`), so this is always the sidebar. */
	activeEnvironmentsTarget(): EnvironmentsSurfaceHost | undefined {
		return this.sidebar;
	}
}
