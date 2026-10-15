/** Narrow an unknown thrown value to a human-readable message, for surfacing in a notification. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
