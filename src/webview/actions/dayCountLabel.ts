/** "3 days" / "1 day", for a developer-log form's selection summary. */
export function dayCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'day' : 'days'}`;
}
