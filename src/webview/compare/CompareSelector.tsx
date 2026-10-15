import { useMemo } from 'react';
import type { EnvironmentRow } from '../../shared/environmentsProtocol';
import { VtSelect, type VtSelectOption } from '../editor/builder/VtSelect';
import { shortVaultDns } from '../environments/vaultDns';

interface CompareSelectorProps {
	environments: EnvironmentRow[];
	sourceId: string;
	targetId: string;
	/** True while the host is authenticating and fetching the selected kinds; disables controls and shows a spinner. */
	isLoading?: boolean;
	/**
	 * True once the last comparison succeeded and hasn't been cleared yet: locks the source/target
	 * selects and kind checkboxes (but not Apply, which keeps acting on the existing comparison) until
	 * "New Compare" is clicked.
	 */
	locked?: boolean;
	/** Inline error message from the host when authentication or the comparison fetch fails. */
	error?: string;
	/** Whether Components (MDL) is selected for the comparison — a default-on toggle. */
	includeMdl: boolean;
	/** Whether Code (Vault Java SDK) is selected for the comparison — a default-on toggle. */
	includeCode: boolean;
	/** Whether at least one entry is checked in the Compare tree — gates the Apply Selected button. */
	hasSelection: boolean;
	/** Whether apply to target is currently enabled for the last comparison. */
	applyEnabled: boolean;
	/** Whether the last comparison's target is a Production Vault — apply is blocked and the checkbox is disabled. */
	targetIsProduction: boolean;
	onSourceChange(id: string): void;
	onTargetChange(id: string): void;
	onToggleMdl(include: boolean): void;
	onToggleCode(include: boolean): void;
	/** Toggle apply-enabled for the current comparison. */
	onToggleApply(enabled: boolean): void;
	/** Trigger "Apply Selected to Target" for all checked entries. */
	onApplySelected(): void;
}

function toOption(env: EnvironmentRow): VtSelectOption {
	return {
		value: env.id,
		label: env.label,
		sublabel: `${shortVaultDns(env.vaultDNS)}${env.isProduction ? ' · PROD' : ''}`,
	};
}

interface EnvSelectProps {
	label: string;
	placeholder: string;
	options: VtSelectOption[];
	value: string;
	inputId: string;
	disabled?: boolean;
	onSelect(id: string): void;
}

/** One labelled Environment combobox built on the shared {@link VtSelect}, matching the Query Builder. */
function EnvSelect({
	label,
	placeholder,
	options,
	value,
	inputId,
	disabled,
	onSelect,
}: EnvSelectProps): JSX.Element {
	const selected = options.find((option) => option.value === value) ?? null;
	return (
		<div className="vt-compare-field">
			<span>{label}</span>
			<VtSelect
				inputId={inputId}
				aria-label={label}
				placeholder={placeholder}
				isDisabled={disabled}
				options={options}
				value={selected}
				onChange={(option) => onSelect(option?.value ?? '')}
			/>
		</div>
	);
}

/**
 * The Compare Environments selector: two {@link VtSelect} comboboxes — source (pull from) and target
 * (apply to) — over the saved Environments, with the target list excluding the chosen source so a Vault
 * can't be compared with itself, plus a Swap button. The chosen pair is controlled by the parent so it
 * persists across tab switches. Choosing a Production target surfaces the apply-is-blocked note up front.
 * "Compare" hands the pair to the host, which connects both on demand and renders the diff in the native
 * Vault Compare view.
 *
 * While the host is working ({@link isLoading}), the controls are disabled and a **Cancel** control
 * replaces Compare so the user can abort a long pull; there is no Back control, since the selector is a
 * top-level tab rather than a sub-screen. If the host reports a failure, the {@link error} message is
 * shown inline so the user can adjust and retry. Once a comparison succeeds, {@link locked} disables the
 * source/target selects and kind checkboxes (Apply stays usable) until the parent's "New Compare" control
 * clears it.
 */
export function CompareSelector({
	environments,
	sourceId,
	targetId,
	isLoading = false,
	locked = false,
	error,
	hasSelection,
	includeMdl,
	includeCode,
	applyEnabled,
	targetIsProduction,
	onSourceChange,
	onTargetChange,
	onToggleMdl,
	onToggleCode,
	onToggleApply,
	onApplySelected,
}: CompareSelectorProps): JSX.Element {
	const sourceOptions = useMemo(() => environments.map(toOption), [environments]);
	const targetOptions = useMemo(
		() => environments.filter((env) => env.id !== sourceId).map(toOption),
		[environments, sourceId],
	);

	const target = environments.find((env) => env.id === targetId);
	const anyKind = includeMdl || includeCode;
	const controlsDisabled = isLoading || locked;

	function handleSource(nextId: string): void {
		onSourceChange(nextId);
		if (nextId === targetId) {
			onTargetChange('');
		}
	}

	if (environments.length < 2) {
		return (
			<div className="vt-compare-selector">
				<p className="vt-hint">Add at least two Environments to compare.</p>
			</div>
		);
	}

	return (
		<div className="vt-compare-selector">
			<EnvSelect
				label="Source (pull from)"
				placeholder="Select a source…"
				inputId="vt-compare-source"
				options={sourceOptions}
				value={sourceId}
				disabled={controlsDisabled}
				onSelect={handleSource}
			/>

			<EnvSelect
				label="Target (apply to)"
				placeholder="Select a target…"
				inputId="vt-compare-target"
				options={targetOptions}
				value={targetId}
				disabled={controlsDisabled || !sourceId}
				onSelect={onTargetChange}
			/>

			<fieldset className="vt-compare-kinds">
				<legend>Compare</legend>
				<label className={`vt-checkbox-field${controlsDisabled ? ' disabled' : ''}`}>
					<input
						id="vt-compare-kind-mdl"
						type="checkbox"
						checked={includeMdl}
						disabled={controlsDisabled}
						onChange={(event) => onToggleMdl(event.target.checked)}
					/>
					<span>Components (MDL)</span>
				</label>
				<label className={`vt-checkbox-field${controlsDisabled ? ' disabled' : ''}`}>
					<input
						id="vt-compare-kind-code"
						type="checkbox"
						checked={includeCode}
						disabled={controlsDisabled}
						onChange={(event) => onToggleCode(event.target.checked)}
					/>
					<span>Code (Vault Java SDK)</span>
				</label>
				{!controlsDisabled && !anyKind && (
					<span className="vt-hint">Select at least one kind to compare.</span>
				)}
			</fieldset>

			<fieldset className="vt-compare-kinds">
				<legend>Apply</legend>
				<label className="vt-checkbox-field">
					<input
						id="vt-compare-apply-enabled"
						type="checkbox"
						checked={applyEnabled}
						disabled={targetIsProduction || isLoading}
						onChange={(event) => onToggleApply(event.target.checked)}
					/>
					<span>Enable Apply to Target Vault</span>
				</label>
				{targetIsProduction && target && (
					<span className="vt-warning">{target.label} is a Production Vault — Apply is disabled.</span>
				)}
			</fieldset>

			{applyEnabled && !targetIsProduction && (
				<button
					type="button"
					className="vt-btn"
					style={{ alignSelf: 'flex-start' }}
					disabled={isLoading || !hasSelection}
					onClick={onApplySelected}
				>
					<span>Apply Selected to {target?.label ?? 'Target'}</span>
				</button>
			)}

			{error && (
				<div className="vt-error" role="alert">
					{error}
				</div>
			)}
		</div>
	);
}
