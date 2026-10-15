import { useState, type FormEvent } from 'react';
import { AuthType } from '../../core/models/environment';
import type { EnvironmentFormSubmit, EnvironmentRow } from '../../shared/environmentsProtocol';
import { VtSelect, type VtSelectOption } from '../editor/builder/VtSelect';
import { EyeIcon, EyeSlashIcon } from '../shell/icons';

interface EnvironmentFormProps {
	/** The row being edited, or undefined when adding. */
	editing?: EnvironmentRow;
	onSubmit(submit: EnvironmentFormSubmit): void;
	onCancel(): void;
}

/** Stand-in shown in the secret field on edit when a value is already stored (the real secret never reaches the webview). */
const EXISTING_SECRET_MASK = '••••••••••••';

interface FieldErrors {
	vaultDNS?: string;
	username?: string;
	secret?: string;
}

/**
 * React port of the add/edit Environment form (formerly a plain-HTML sidebar webview). An optional
 * Label field lets users distinguish environments that share a Vault. When left blank the label is
 * seeded from the DNS on add and adopted from the Vault on connect. On edit a blank secret keeps the
 * current one. Basic auth shows a username + password; Session-ID auth hides the username and
 * relabels the secret.
 */
export function EnvironmentForm({
	editing,
	onSubmit,
	onCancel,
}: EnvironmentFormProps): JSX.Element {
	const mode = editing ? 'edit' : 'add';
	const [vaultDNS, setVaultDNS] = useState(editing?.vaultDNS ?? '');
	// Pre-fill only when the user previously set a custom label; leave blank for auto-adopted labels
	// so the placeholder can show the current value without making it look like a user-set one.
	const [label, setLabel] = useState(editing?.hasCustomLabel ? editing.label : '');
	const [authType, setAuthType] = useState<AuthType>(editing?.authType ?? AuthType.Basic);
	const [username, setUsername] = useState(editing?.username ?? '');
	const [secret, setSecret] = useState('');
	const [errors, setErrors] = useState<FieldErrors>({});
	const [secretVisible, setSecretVisible] = useState(false);

	const isBasic = authType === AuthType.Basic;
	const secretLabel =
		authType === AuthType.ApiAccessToken ? 'API Access Token' : 'Session ID';

	const authTypeOptions: VtSelectOption[] = [
		{ value: AuthType.Basic, label: 'Basic (User Name/Password)' },
		{ value: AuthType.SessionId, label: 'Session ID' },
		{ value: AuthType.ApiAccessToken, label: 'API Access Token' },
	];
	const selectedAuthType = authTypeOptions.find((option) => option.value === authType) ?? null;

	function validate(): FieldErrors {
		const next: FieldErrors = {};
		if (!vaultDNS.trim()) {
			next.vaultDNS = 'A Vault DNS is required.';
		}
		if (isBasic && !username.trim()) {
			next.username = 'A user name is required.';
		}
		if (mode === 'add' && !secret) {
			next.secret = isBasic ? 'A password is required.' : `A ${secretLabel.toLowerCase()} is required.`;
		}
		return next;
	}

	function handleSubmit(event: FormEvent): void {
		event.preventDefault();
		const validationErrors = validate();
		setErrors(validationErrors);
		if (Object.keys(validationErrors).length > 0) {
			return;
		}
		onSubmit({
			mode,
			id: editing?.id,
			vaultDNS: vaultDNS.trim(),
			label: label.trim() || undefined,
			username: isBasic ? username.trim() : undefined,
			authType,
			secret,
		});
	}

	return (
		<form className="vt-env-form" onSubmit={handleSubmit}>
			<label className="vt-field">
				<span>Vault DNS</span>
				<input
					type="text"
					autoComplete="off"
					placeholder="myvault.veevavault.com"
					value={vaultDNS}
					onChange={(event) => setVaultDNS(event.target.value)}
				/>
				<span className="vt-field-error">{errors.vaultDNS}</span>
			</label>

			<label className="vt-field">
				<span>Label <span className="vt-hint" style={{ fontSize: '11px' }}>(optional)</span></span>
				<input
					type="text"
					autoComplete="off"
					placeholder={editing && !editing.hasCustomLabel ? editing.label : 'Defaults to Vault Name'}
					value={label}
					onChange={(event) => setLabel(event.target.value)}
				/>
				<span className="vt-field-error" />
			</label>

			<label className="vt-field">
				<span>Authentication Method</span>
				<VtSelect
					inputId="vt-auth-type-input"
					aria-label="Authentication Method"
					isSearchable={false}
					isClearable={false}
					options={authTypeOptions}
					value={selectedAuthType}
					onChange={(option) => setAuthType((option as VtSelectOption).value as AuthType)}
				/>
				<span className="vt-field-error" />
			</label>

			{isBasic && (
				<label className="vt-field">
					<span>User Name</span>
					<input
						type="text"
						autoComplete="off"
						value={username}
						onChange={(event) => setUsername(event.target.value)}
					/>
					<span className="vt-field-error">{errors.username}</span>
				</label>
			)}

			<label className="vt-field">
				<span>{isBasic ? 'Password' : secretLabel}</span>
				<div className="vt-input-with-toggle">
					<input
						type={secretVisible ? 'text' : 'password'}
						autoComplete="off"
						placeholder={mode === 'edit' && !secret ? EXISTING_SECRET_MASK : undefined}
						value={secret}
						onChange={(event) => {
							const next = event.target.value;
							setSecret(next);
							if (!next) {
								setSecretVisible(false);
							}
						}}
					/>
					{secret && (
						<button
							type="button"
							className="vt-input-toggle"
							aria-label={secretVisible ? 'Hide password' : 'Show password'}
							onClick={() => setSecretVisible((visible) => !visible)}
						>
							{secretVisible ? <EyeSlashIcon /> : <EyeIcon />}
						</button>
					)}
				</div>
				{mode === 'edit' && (
					<span className="vt-hint">
						Enter a new {isBasic ? 'password' : secretLabel.toLowerCase()} to change it.
					</span>
				)}
				<span className="vt-field-error">{errors.secret}</span>
			</label>

			<div className="vt-toolbar">
				<button type="submit" className="vt-btn">
					{mode === 'add' ? 'Add' : 'Save'}
				</button>
				<button type="button" className="vt-btn secondary" onClick={onCancel}>
					Cancel
				</button>
			</div>
		</form>
	);
}
