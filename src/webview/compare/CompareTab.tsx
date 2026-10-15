import { useEffect, useMemo, useRef, useState } from 'react';
import type { EnvironmentRow } from '../../shared/environmentsProtocol';
import { onEnvironmentsSnapshot, requestEnvironments } from '../environments/environmentsClient';
import { applySelected, cancelCompare, clearCompare as sendClearCompare, onCompareResult, onSelectionChanged, onSessionState, setApplyEnabled as sendSetApplyEnabled, signalCompareReady, startCompare } from './compareClient';
import { CompareSelector } from './CompareSelector';
import { Spinner } from '../editor/Spinner';
import { SwapIcon } from '../shell/icons';

/**
 * The Compare Environments tab: a source/target selector over the saved Environments plus the
 * Components/Code kind toggles, driving comparisons over the dedicated `compareEnvironments` channel.
 * The tab stays mounted across tab switches (like every shell tab), so its selection state persists
 * without a reset when the tab is re-shown.
 *
 * The source defaults to the active Environment **once**, the first time Environments load — thereafter
 * the user's source/target/kind choices are left untouched. There is no Back control; while a comparison
 * runs the selector shows a Cancel control that aborts the in-flight run. After a successful comparison
 * the tab stays on the selector while the native Vault Compare view populates, and the source/target/kind
 * selects and Swap lock — "Generate Compare" becomes "New Compare", which clears the Vault Compare view
 * and any diffs it opened, then unlocks the controls (left exactly as they were) for the next run.
 */
export function CompareTab(): JSX.Element {
	const [environments, setEnvironments] = useState<EnvironmentRow[]>([]);
	const [sourceId, setSourceId] = useState<string>('');
	const [targetId, setTargetId] = useState<string>('');
	// Both kinds default on. Kept here (not in CompareSelector) so the choice persists across tab switches.
	const [includeMdl, setIncludeMdl] = useState(true);
	const [includeCode, setIncludeCode] = useState(true);
	const [isComparing, setIsComparing] = useState(false);
	// Locked once a comparison succeeds; cleared when "New Compare" is clicked. Gates the
	// source/target/kinds/Swap controls — Apply stays usable since it acts on the existing comparison.
	const [isLocked, setIsLocked] = useState(false);
	const [hasSelection, setHasSelection] = useState(false);
	const [compareError, setCompareError] = useState<string | undefined>();
	// Local state: updated optimistically on toggle and reset to false when a new comparison starts.
	const [applyEnabled, setApplyEnabled] = useState(false);

	// Derived from the environments list so it reflects the current dropdown selection immediately,
	// not just after a comparison runs.
	const targetIsProduction = useMemo(
		() => environments.find((env) => env.id === targetId)?.isProduction ?? false,
		[environments, targetId],
	);

	// Shared by canCompare/swapDisabled: true while a run is in flight or the prior comparison is locked in.
	const controlsLocked = isComparing || isLocked;
	const canCompare =
		!controlsLocked && !!sourceId && !!targetId && sourceId !== targetId && (includeMdl || includeCode);
	const swapDisabled = controlsLocked || !sourceId || !targetId;

	function handleSwap(): void {
		setSourceId(targetId);
		setTargetId(sourceId);
	}

	// Tracks whether a compare request is in flight, so a result that arrives after the user cancelled is
	// silently discarded.
	const pendingCompareRef = useRef(false);
	// Guards the one-time source default so a later snapshot (e.g. after connecting) can't overwrite the
	// user's own source choice.
	const defaultedRef = useRef(false);

	useEffect(() => {
		const offSnapshot = onEnvironmentsSnapshot((snapshot) => {
			setEnvironments(snapshot.environments);
			if (!defaultedRef.current && snapshot.environments.length > 0) {
				defaultedRef.current = true;
				const active = snapshot.environments.find((env) => env.isActive);
				if (active) {
					setSourceId(active.id);
				}
			}
		});
		const offResult = onCompareResult((message) => {
			if (!pendingCompareRef.current) {
				return; // user already cancelled — discard stale result
			}
			pendingCompareRef.current = false;
			setIsComparing(false);
			if (message.status === 'success') {
				setCompareError(undefined);
				setIsLocked(true);
				// The host creates a fresh session (applyEnabled=false) for each compare run.
				// Re-sync the host's new session to match the current checkbox state.
				setApplyEnabled((current) => {
					if (current) {
						sendSetApplyEnabled(true);
					}
					return current;
				});
				// Stay on the selector; the native Vault Compare view populates with the results.
			} else {
				setCompareError(message.errorMessage);
			}
		});
		const offSelection = onSelectionChanged(setHasSelection);
		// The host's live comparison: its reply to our `ready` below, and a push whenever a comparison
		// starts or is cleared. None of this tab's state survives a webview rebuild, so adopt the
		// comparison wholesale — otherwise a reload would leave an empty, unlocked form sitting above a
		// populated Vault Compare tree. No comparison: leave the controls as they are (on a fresh mount
		// they are already empty) and just make sure they're unlocked.
		const offSessionState = onSessionState((session) => {
			if (pendingCompareRef.current) {
				// Our own run landing. This tab already holds the state it just sent, including an Apply
				// tick the host's brand-new session doesn't have yet; adopting the session here would
				// clear that tick before the result handler below can carry it over. It locks itself on
				// the result instead.
				return;
			}
			setIsLocked(session !== undefined);
			if (!session) {
				return;
			}
			// The restored pair is the user's choice as much as one they typed, so the environments
			// snapshot's one-time source default must not overwrite it.
			defaultedRef.current = true;
			setSourceId(session.sourceId);
			setTargetId(session.targetId);
			setIncludeMdl(session.kinds.mdl);
			setIncludeCode(session.kinds.code);
			setApplyEnabled(session.applyEnabled);
		});
		requestEnvironments();
		// Subscribed now, so ask the host to replay what this tab can't know by itself: its live
		// comparison, and a tree selection made before this selector mounted.
		signalCompareReady();
		return () => {
			offSnapshot();
			offResult();
			offSelection();
			offSessionState();
		};
	}, []);

	function handleCompare(): void {
		pendingCompareRef.current = true;
		setCompareError(undefined);
		setIsComparing(true);
		startCompare({ sourceId, targetId, kinds: { mdl: includeMdl, code: includeCode } });
	}

	function handleCancel(): void {
		if (pendingCompareRef.current) {
			cancelCompare();
		}
		pendingCompareRef.current = false;
		setIsComparing(false);
		setCompareError(undefined);
	}

	// Clears the host's comparison (closing the Vault Compare view and any diffs it opened) and unlocks
	// the controls, leaving source/target/kinds exactly as they were for the next run.
	function handleNewCompare(): void {
		sendClearCompare();
		setIsLocked(false);
	}

	return (
		<div className="vt-actions-panel">
			<header className="vt-header">
				<div className="vt-header-left">
					<span className="title">Compare Environments</span>
				</div>
				<div className="vt-header-right">
					{isComparing ? (
						<>
							<Spinner label="Comparing…" />
							<button type="button" className="vt-btn secondary" onClick={handleCancel}>
								Cancel
							</button>
						</>
					) : isLocked ? (
						<button type="button" className="vt-btn" onClick={handleNewCompare}>
							<span>New Compare</span>
						</button>
					) : (
						<button
							type="button"
							className={`vt-btn${canCompare ? '' : ' disabled'}`}
							aria-disabled={!canCompare}
							onClick={canCompare ? handleCompare : undefined}
						>
							<span>Generate Compare</span>
						</button>
					)}
					<button
						type="button"
						className={`vt-btn secondary icon-only${swapDisabled ? ' disabled' : ''}`}
						data-tooltip="Swap source and target"
						data-tooltip-dir="below"
						aria-label="Swap source and target"
						aria-disabled={swapDisabled}
						onClick={swapDisabled ? undefined : handleSwap}
					>
						<SwapIcon />
					</button>
				</div>
			</header>
			<CompareSelector
				environments={environments}
				sourceId={sourceId}
				targetId={targetId}
				isLoading={isComparing}
				locked={isLocked}
				hasSelection={hasSelection}
				error={compareError}
				includeMdl={includeMdl}
				includeCode={includeCode}
				applyEnabled={applyEnabled}
				targetIsProduction={targetIsProduction}
				onSourceChange={setSourceId}
				onTargetChange={setTargetId}
				onToggleMdl={setIncludeMdl}
				onToggleCode={setIncludeCode}
				onToggleApply={(enabled) => {
					setApplyEnabled(enabled);
					sendSetApplyEnabled(enabled);
				}}
				onApplySelected={applySelected}
			/>
		</div>
	);
}
