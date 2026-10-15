import { describe, expect, it } from 'vitest';
import { partialFailureMessage } from './partialFailureMessage';

describe('partialFailureMessage', () => {
	describe('Format A — log downloads (failedItemNoun present)', () => {
		it('pluralises the item noun for multiple failures', () => {
			expect(
				partialFailureMessage(3, ['2026-08-20', '2026-08-19'], 'no log for that day', {
					successVerb: 'Downloaded',
					successNoun: 'logs',
					failedItemNoun: 'day',
				}),
			).toBe(
				"Downloaded 3 of 5 logs. Couldn’t download 2 days (2026-08-20, 2026-08-19): no log for that day",
			);
		});

		it('uses the singular item noun for a single failure', () => {
			expect(
				partialFailureMessage(4, ['2026-08-20'], 'boom', {
					successVerb: 'Downloaded',
					successNoun: 'logs',
					failedItemNoun: 'day',
				}),
			).toBe("Downloaded 4 of 5 logs. Couldn’t download 1 day (2026-08-20): boom");
		});

		it('omits the success noun word when successNoun is absent', () => {
			expect(
				partialFailureMessage(1, ['item-a', 'item-b'], 'reason', {
					successVerb: 'Downloaded',
					failedItemNoun: 'item',
				}),
			).toBe("Downloaded 1 of 3. Couldn’t download 2 items (item-a, item-b): reason");
		});
	});

	describe('Format B — SDK extraction (failedItemNoun absent)', () => {
		it('uses the (N failed) form for multiple failures', () => {
			expect(
				partialFailureMessage(
					2,
					['com.veeva.vault.custom.triggers.A', 'com.veeva.vault.custom.actions.B'],
					'HTTP 500',
					{ successVerb: 'Extracted' },
				),
			).toBe(
				"Extracted 2 of 4 (2 failed). Couldn’t download com.veeva.vault.custom.triggers.A, com.veeva.vault.custom.actions.B: HTTP 500",
			);
		});

		it('uses the (N failed) form for a single failure', () => {
			expect(
				partialFailureMessage(2, ['com.veeva.vault.custom.triggers.Boom'], 'HTTP 404', {
					successVerb: 'Extracted',
				}),
			).toBe(
				"Extracted 2 of 3 (1 failed). Couldn’t download com.veeva.vault.custom.triggers.Boom: HTTP 404",
			);
		});
	});

	describe('empty failedLabels guard', () => {
		it('returns an empty string when there are no failures', () => {
			expect(
				partialFailureMessage(5, [], 'reason', { successVerb: 'Downloaded', successNoun: 'logs', failedItemNoun: 'day' }),
			).toBe('');
		});
	});
});
