import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, ClearDateIcon } from '../shell/icons';
import { DateSingleSelect } from './DateCalendar';

interface DatePopoverFieldProps {
	/** The currently selected `yyyy-mm-dd` UTC day, or undefined when no cutoff is set. */
	selected?: string;
	/** Inclusive earliest selectable day (`yyyy-mm-dd`); earlier days render disabled. */
	earliest: string;
	/** Inclusive latest selectable day (`yyyy-mm-dd`, today UTC); later days render disabled. */
	latest: string;
	/** Shown on the trigger when {@link selected} is undefined. */
	placeholder: string;
	id?: string;
	'aria-label'?: string;
	isDisabled?: boolean;
	/** Replace the selection with this day, or clear it (undefined). */
	onSelect(day: string | undefined): void;
}

/** "August 15, 2026" for the trigger button — friendlier than the raw `yyyy-mm-dd` it wraps. */
function formatDisplayDate(day: string): string {
	return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
		timeZone: 'UTC',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

/**
 * A single-date field styled like the other form controls, opening the shared {@link DateSingleSelect}
 * calendar in a popover rather than showing it inline — Config Report's date is one field among several,
 * unlike the Developer Log forms where the calendar is the form's sole control. Picking a day auto-closes
 * the popover; a "×" on the trigger clears the selection without reopening it. Closes on click-outside
 * or Escape.
 */
export function DatePopoverField({
	selected,
	earliest,
	latest,
	placeholder,
	id,
	'aria-label': ariaLabel,
	isDisabled = false,
	onSelect,
}: DatePopoverFieldProps): JSX.Element {
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const handlePointerDown = (event: MouseEvent): void => {
			if (!containerRef.current?.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				setIsOpen(false);
			}
		};
		document.addEventListener('mousedown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('mousedown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [isOpen]);

	return (
		<div className="vt-date-field" ref={containerRef}>
			<div className="vt-input-with-toggle">
				<button
					type="button"
					id={id}
					aria-label={ariaLabel}
					aria-haspopup="dialog"
					aria-expanded={isOpen}
					className="vt-date-trigger"
					disabled={isDisabled}
					onClick={() => setIsOpen((open) => !open)}
				>
					<span className="vt-date-trigger-icon">
						<CalendarIcon />
					</span>
					<span className={`vt-date-trigger-value${selected ? '' : ' vt-date-trigger-placeholder'}`}>
						{selected ? formatDisplayDate(selected) : placeholder}
					</span>
				</button>
				{selected && (
					<button
						type="button"
						className="vt-input-toggle"
						aria-label="Clear date"
						disabled={isDisabled}
						onClick={() => onSelect(undefined)}
					>
						<ClearDateIcon />
					</button>
				)}
			</div>

			{isOpen && (
				<div className="vt-date-popover" role="dialog" aria-modal="false">
					<DateSingleSelect
						selected={selected}
						earliest={earliest}
						latest={latest}
						isDisabled={isDisabled}
						onSelect={(day) => {
							onSelect(day);
							setIsOpen(false);
						}}
					/>
				</div>
			)}
		</div>
	);
}
