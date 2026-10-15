import { useRef, useState } from 'react';
import type { EnvironmentRow } from '../../shared/environmentsProtocol';
import {
	CaretRightIcon,
	ConnectIcon,
	DisconnectIcon,
	OpenExternalIcon,
	PencilIcon,
	PowerIcon,
	TrashIcon,
} from '../shell/icons';
import { shortVaultDns } from './vaultDns';

interface EnvironmentListProps {
	environments: EnvironmentRow[];
	/** Bumped to force-reopen the current environment's Vault info section; see `EnvironmentsPanel`. */
	revealNonce?: number;
	onAdd(): void;
	onConnect(id: string): void;
	onDisconnect(id: string): void;
	onSetActive(id: string): void;
	onEdit(row: EnvironmentRow): void;
	onRemove(id: string): void;
	onOpenVault(id: string): void;
}

/** The info-row label that gets rendered as a link instead of static text (matches `buildInfoRows`). */
const VAULT_DNS_LABEL = 'Vault DNS';

const STATUS_LABEL: Record<EnvironmentRow['status'], string> = {
	connected: 'Connected',
	connecting: 'Connecting…',
	error: 'Error',
	disconnected: 'Disconnected',
};

/**
 * An icon-only card action. The label is the accessible name and an instant hover/focus tooltip. The
 * tooltip is `position: fixed` with JS-measured coordinates so it escapes the panel's `overflow:hidden`
 * scroll containers, which would otherwise clip a normally-positioned bubble.
 */
function IconButton({
	label,
	danger,
	onClick,
	children,
}: {
	label: string;
	danger?: boolean;
	onClick(): void;
	children: JSX.Element;
}): JSX.Element {
	const ref = useRef<HTMLButtonElement>(null);
	const [tooltipPos, setTooltipPos] = useState<{ top: number; right: number } | null>(null);

	const show = (): void => {
		const rect = ref.current?.getBoundingClientRect();
		if (rect) {
			setTooltipPos({ top: rect.bottom + 5, right: window.innerWidth - rect.right });
		}
	};
	const hide = (): void => setTooltipPos(null);

	return (
		<button
			ref={ref}
			type="button"
			className={`vt-icon-btn ${danger ? 'danger' : ''}`}
			aria-label={label}
			onMouseEnter={show}
			onMouseLeave={hide}
			onFocus={show}
			onBlur={hide}
			onClick={() => {
				hide();
				onClick();
			}}
		>
			{children}
			{tooltipPos && (
				<span className="vt-tooltip" style={{ top: tooltipPos.top, right: tooltipPos.right }}>
					{label}
				</span>
			)}
		</button>
	);
}

function EnvironmentCard({
	env,
	isCurrent,
	forceOpenNonce,
	onConnect,
	onDisconnect,
	onSetActive,
	onEdit,
	onRemove,
	onOpenVault,
}: {
	env: EnvironmentRow;
	isCurrent: boolean;
	/** Bumped to force the Vault info `<details>` back open; undefined leaves it fully uncontrolled. */
	forceOpenNonce?: number;
	onConnect(id: string): void;
	onDisconnect(id: string): void;
	onSetActive(id: string): void;
	onEdit(row: EnvironmentRow): void;
	onRemove(id: string): void;
	onOpenVault(id: string): void;
}): JSX.Element {
	const live = env.status === 'connected' || env.status === 'connecting';
	const isActive = env.isActive && env.status === 'connected';
	return (
		<div
			className={`vt-env-card status-${env.status} ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''}`}
		>
			<div className="vt-env-head">
				<div className="vt-env-title-group">
					<span
						className={`vt-status-dot ${env.status}`}
						title={STATUS_LABEL[env.status]}
						aria-hidden="true"
					/>
					<span className="vt-env-label">{env.label}</span>
					<span className="vt-env-dns">({shortVaultDns(env.vaultDNS)})</span>
					{isActive && <span className="vt-badge neutral">active</span>}
					{env.isProduction && <span className="vt-badge production">PROD</span>}
				</div>
			</div>
			<div className="vt-env-actions">
				{live ? (
					<IconButton label="Disconnect" onClick={() => onDisconnect(env.id)}>
						<DisconnectIcon />
					</IconButton>
				) : (
					<IconButton label="Connect" onClick={() => onConnect(env.id)}>
						<ConnectIcon />
					</IconButton>
				)}
				{!isActive && env.status === 'connected' && (
					<IconButton label="Set as active" onClick={() => onSetActive(env.id)}>
						<PowerIcon />
					</IconButton>
				)}
				<IconButton label="Edit" onClick={() => onEdit(env)}>
					<PencilIcon />
				</IconButton>
				<IconButton label="Remove" danger onClick={() => onRemove(env.id)}>
					<TrashIcon />
				</IconButton>
			</div>
			{(env.status === 'connecting' || env.status === 'error') && (
				<div className="vt-env-status">
					{STATUS_LABEL[env.status]}
					{env.error ? ` — ${env.error}` : ''}
				</div>
			)}

			{env.info && env.info.length > 0 && (
				// `key` forces a remount on every reveal, so `open` re-applies even if the user had since
				// manually collapsed it; otherwise React only re-applies `open` when its value changes.
				<details
					className="vt-env-info"
					key={forceOpenNonce ?? 'closed'}
					open={forceOpenNonce !== undefined}
				>
					<summary>
						<span className="vt-env-info-caret"><CaretRightIcon /></span>
						Vault Info
					</summary>
					{env.info.map((row) =>
						row.label === VAULT_DNS_LABEL ? (
							<button
								key={row.label}
								type="button"
								className="vt-info-row vt-info-row-link"
								title={`Open ${row.value} in browser`}
								onClick={() => onOpenVault(env.id)}
							>
								<span className="vt-info-label">{row.label}</span>
								<span className="vt-info-value vt-info-link">
									{row.value}
									<span className="vt-info-link-icon">
										<OpenExternalIcon />
									</span>
								</span>
							</button>
						) : (
							<div key={row.label} className="vt-info-row">
								<span className="vt-info-label">{row.label}</span>
								<span className="vt-info-value">{row.value}</span>
							</div>
						),
					)}
				</details>
			)}
		</div>
	);
}

/**
 * The Environments tab's list view. The active + connected environment (if any) is pinned in a
 * "Current" section at the top, visually distinct from the rest; every environment — including
 * other connected ones — still appears in the "All environments" list below. Replaces the old
 * native tree; the right-click context menu becomes inline icon buttons. No manual refresh: the
 * host re-pushes the snapshot on every change.
 */
export function EnvironmentList({
	environments,
	revealNonce,
	onAdd,
	onConnect,
	onDisconnect,
	onSetActive,
	onEdit,
	onRemove,
	onOpenVault,
}: EnvironmentListProps): JSX.Element {
	const current = environments.find((env) => env.isActive && env.status === 'connected');
	const cardProps = { onConnect, onDisconnect, onSetActive, onEdit, onRemove, onOpenVault };

	return (
		<div className="vt-env-list">
			{current && (
				<div className="vt-env-section vt-env-section-current">
					<h4 className="vt-env-section-title">Current Environment</h4>
					<EnvironmentCard env={current} isCurrent forceOpenNonce={revealNonce} {...cardProps} />
				</div>
			)}

			<div className="vt-env-section">
				<div className="vt-env-section-head">
					<h4 className="vt-env-section-title">All Environments</h4>
					<button type="button" className="vt-btn" onClick={onAdd}>
						Add Environment
					</button>
				</div>
				{environments.length === 0 ? (
					<p className="vt-hint">No environments yet. Add one to get started.</p>
				) : (
					environments
						.filter((env) => env.id !== current?.id)
						.map((env) => <EnvironmentCard key={env.id} env={env} isCurrent={false} {...cardProps} />)
				)}
			</div>
		</div>
	);
}
