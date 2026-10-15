import { useState } from 'react';

/** A visible month, identified by its UTC year and 0-based month. */
interface MonthView {
	year: number;
	month: number;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** The `yyyy-mm-dd` UTC day for a year / 0-based month / day-of-month. */
function utcDayFor(year: number, month: number, day: number): string {
	return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** The UTC month a `yyyy-mm-dd` falls in, for seeding and shifting the visible month. */
function monthOf(day: string): MonthView {
	const date = new Date(`${day}T00:00:00Z`);
	return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

/** The visible month shifted by whole months (negative reaches back), normalising year rollover. */
function shiftMonth(view: MonthView, delta: number): MonthView {
	const shifted = new Date(Date.UTC(view.year, view.month + delta, 1));
	return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

/** "August 2026" for the visible month's header. */
function monthLabel(view: MonthView): string {
	return new Date(Date.UTC(view.year, view.month, 1)).toLocaleDateString(undefined, {
		timeZone: 'UTC',
		month: 'long',
		year: 'numeric',
	});
}

/**
 * The grid cells for a month: leading `null`s to align the 1st under its weekday, then each day number.
 * Rendered into a 7-column grid, so the blanks are what put day 1 in the right column.
 */
function monthCells(view: MonthView): (number | null)[] {
	const firstWeekday = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();
	const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
	const leadingBlanks: null[] = Array<null>(firstWeekday).fill(null);
	const days = Array.from({ length: daysInMonth }, (_, index) => index + 1);
	return [...leadingBlanks, ...days];
}

interface CalendarGridProps {
	view: MonthView;
	/** Inclusive earliest selectable day (`yyyy-mm-dd`); earlier days render disabled. */
	earliest: string;
	/** Inclusive latest selectable day (`yyyy-mm-dd`); later days render disabled. */
	latest: string;
	isDisabled: boolean;
	isSelected(day: string): boolean;
	onDayClick(day: string): void;
	onPrevMonth(): void;
	onNextMonth(): void;
}

/**
 * The pure month grid — nav header plus day cells — shared by {@link DateMultiSelect} and
 * {@link DateSingleSelect}. Selection is entirely the caller's concern via {@link CalendarGridProps.isSelected}
 * and {@link CalendarGridProps.onDayClick}; this component only knows how to lay out a month and mark days
 * in/out of `[earliest, latest]`.
 */
function CalendarGrid({
	view,
	earliest,
	latest,
	isDisabled,
	isSelected,
	onDayClick,
	onPrevMonth,
	onNextMonth,
}: CalendarGridProps): JSX.Element {
	return (
		<div className="vt-calendar" role="group" aria-label="Select dates">
			<div className="vt-calendar-head">
				<button
					type="button"
					className="vt-calendar-nav"
					aria-label="Previous month"
					disabled={isDisabled}
					onClick={onPrevMonth}
				>
					‹
				</button>
				<span className="vt-calendar-title" aria-live="polite">
					{monthLabel(view)}
				</span>
				<button
					type="button"
					className="vt-calendar-nav"
					aria-label="Next month"
					disabled={isDisabled}
					onClick={onNextMonth}
				>
					›
				</button>
			</div>

			<div className="vt-calendar-grid">
				{WEEKDAY_LABELS.map((label) => (
					<div key={label} className="vt-calendar-weekday" aria-hidden="true">
						{label}
					</div>
				))}
				{monthCells(view).map((day, index) => {
					if (day === null) {
						return <div key={`blank-${index}`} className="vt-calendar-blank" />;
					}
					const iso = utcDayFor(view.year, view.month, day);
					const outOfRange = iso < earliest || iso > latest;
					const selected = isSelected(iso);
					return (
						<button
							key={iso}
							type="button"
							className={`vt-calendar-day${selected ? ' selected' : ''}`}
							aria-pressed={selected}
							aria-label={iso}
							disabled={isDisabled || outOfRange}
							onClick={() => onDayClick(iso)}
						>
							{day}
						</button>
					);
				})}
			</div>
		</div>
	);
}

interface DateMultiSelectProps {
	/** The currently selected `yyyy-mm-dd` UTC days. */
	selected: string[];
	/** Inclusive earliest selectable day (`yyyy-mm-dd`); earlier days render disabled. */
	earliest: string;
	/** Inclusive latest selectable day (`yyyy-mm-dd`, today UTC); later days render disabled. */
	latest: string;
	/** Disables the whole calendar while a download is in flight. */
	isDisabled?: boolean;
	/** Add the day to the selection if absent, or remove it if already selected. */
	onToggle(day: string): void;
}

/**
 * An inline month calendar for picking multiple UTC days. Clicking a day toggles it in or out of
 * {@link DateMultiSelectProps.selected}; days outside `[earliest, latest]` (the log's retention window)
 * render disabled so an out-of-range day can't be chosen. The visible month is local UI state seeded from
 * `latest` (today); the selection itself is owned by the parent so it survives leaving the screen. Shared
 * by both Developer Log forms.
 */
export function DateMultiSelect({
	selected,
	earliest,
	latest,
	isDisabled = false,
	onToggle,
}: DateMultiSelectProps): JSX.Element {
	const [view, setView] = useState<MonthView>(() => monthOf(latest));
	const selectedDays = new Set(selected);

	return (
		<CalendarGrid
			view={view}
			earliest={earliest}
			latest={latest}
			isDisabled={isDisabled}
			isSelected={(day) => selectedDays.has(day)}
			onDayClick={onToggle}
			onPrevMonth={() => setView(shiftMonth(view, -1))}
			onNextMonth={() => setView(shiftMonth(view, 1))}
		/>
	);
}

interface DateSingleSelectProps {
	/** The currently selected `yyyy-mm-dd` UTC day, or undefined when no cutoff is set. */
	selected?: string;
	/** Inclusive earliest selectable day (`yyyy-mm-dd`); earlier days render disabled. */
	earliest: string;
	/** Inclusive latest selectable day (`yyyy-mm-dd`, today UTC); later days render disabled. */
	latest: string;
	/** Disables the whole calendar while a download is in flight. */
	isDisabled?: boolean;
	/** Replace the selection with this day, or clear it (undefined) if it's already selected. */
	onSelect(day: string | undefined): void;
}

/**
 * The same month calendar as {@link DateMultiSelect}, in single-day mode: clicking a day replaces
 * whatever was previously selected, and clicking the already-selected day clears it back to "no date".
 * Used by the Config Report form's "modified since" cutoff, behind a popover trigger (see
 * `DatePopoverField`) rather than shown inline, since it's one field among several rather than a form's
 * sole control.
 */
export function DateSingleSelect({
	selected,
	earliest,
	latest,
	isDisabled = false,
	onSelect,
}: DateSingleSelectProps): JSX.Element {
	const [view, setView] = useState<MonthView>(() => monthOf(selected ?? latest));

	return (
		<CalendarGrid
			view={view}
			earliest={earliest}
			latest={latest}
			isDisabled={isDisabled}
			isSelected={(day) => day === selected}
			onDayClick={(day) => onSelect(day === selected ? undefined : day)}
			onPrevMonth={() => setView(shiftMonth(view, -1))}
			onNextMonth={() => setView(shiftMonth(view, 1))}
		/>
	);
}
