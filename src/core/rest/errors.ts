import type { VaultResponse } from './types';

/** Thrown for network/transport failures and non-recoverable API errors. */
export class VaultApiError extends Error {
	constructor(
		message: string,
		readonly type: string = 'VAULT_API_ERROR',
		readonly response?: Record<string, unknown>,
	) {
		super(message);
		this.name = 'VaultApiError';
	}
}

export function isVaultResponse(value: unknown): value is VaultResponse {
	return (
		typeof value === 'object' &&
		value !== null &&
		'responseStatus' in value &&
		typeof (value as { responseStatus: unknown }).responseStatus === 'string'
	);
}

/**
 * Whether a Vault response is an actual failure. Vault uses `SUCCESS`, `WARNING`, `FAILURE`, and
 * `EXCEPTION`; `WARNING` still carries valid data (e.g. a `DUPLICATE` "duplicate query execution"
 * notice when the same query re-runs — as CSV export does), so only `FAILURE`/`EXCEPTION` are errors.
 */
export function isFailure(response: VaultResponse): boolean {
	return response.responseStatus !== 'SUCCESS' && response.responseStatus !== 'WARNING';
}

export function firstErrorMessage(response: VaultResponse): string | undefined {
	return response.errors?.[0]?.message ?? response.responseMessage;
}

/**
 * Whether a response or error indicates an expired/invalid session. Checked case-insensitively
 * against the error `type` and, as a fallback, any message text.
 */
export function isInvalidSession(responseOrError: VaultResponse | Error | string): boolean {
	const needle = 'INVALID_SESSION_ID';
	if (typeof responseOrError === 'string') {
		return responseOrError.toUpperCase().includes(needle);
	}
	if (responseOrError instanceof Error) {
		return responseOrError.message.toUpperCase().includes(needle);
	}
	return (responseOrError.errors ?? []).some(
		(error) =>
			error.type?.toUpperCase() === needle || (error.message ?? '').toUpperCase().includes(needle),
	);
}
