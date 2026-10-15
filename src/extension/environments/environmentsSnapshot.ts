import type { Environment } from '../../core/models/environment';
import { isProductionVault } from '../../core/production';
import type { EnvironmentRow, EnvironmentsSnapshot } from '../../shared/environmentsProtocol';
import { buildInfoRows } from './infoRows';
import type { ConnectionState } from '../connection/types';

/** Per-environment connection-state lookup; `ConnectionManager` satisfies it. */
export interface ConnectionStateLookup {
	getConnectionState(envId: string): ConnectionState;
}

/**
 * Project the saved environments + each one's own live connection state into the snapshot the
 * Environments tab renders. Any number of environments can show a live status at once (see ADR
 * 0004) — each row's status comes from that environment's own connection, independent of the others.
 */
export function buildEnvironmentsSnapshot(
	environments: Environment[],
	connections: ConnectionStateLookup,
	activeId: string | undefined,
): EnvironmentsSnapshot {
	return {
		environments: environments.map((env) =>
			toRow(env, connections.getConnectionState(env.id), activeId),
		),
	};
}

function toRow(env: Environment, state: ConnectionState, activeId: string | undefined): EnvironmentRow {
	const connectedInfo = state.status === 'connected' ? state.info : undefined;
	return {
		id: env.id,
		label: env.label,
		hasCustomLabel: env.hasCustomLabel,
		vaultDNS: env.vaultDNS,
		authType: env.authType,
		username: env.username,
		status: state.status,
		isActive: env.id === activeId,
		isProduction:
			!!connectedInfo &&
			isProductionVault(connectedInfo.domain?.domainType, connectedInfo.environment.vaultDNS),
		info: connectedInfo ? buildInfoRows(connectedInfo) : undefined,
		error: state.status === 'error' ? state.error : undefined,
	};
}
