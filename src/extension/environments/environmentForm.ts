import { normalizeDns } from '../../core/models/environment';
import type { EnvironmentFormSubmit } from '../../shared/environmentsProtocol';
import type { EnvironmentInput } from './environmentService';

/**
 * Split a React-form submission into the non-secret {@link EnvironmentInput} the service persists and
 * the secret to store. A blank secret on edit means "keep the current one" (represented as
 * `undefined`), which the form disallows on add.
 *
 * Label resolution (in priority order):
 * 1. A non-empty `submit.label` — user-provided; stored as sticky (suppresses auto-adopt on connect).
 * 2. `existingLabel` — the caller passes the current vault-adopted label when the form's label field
 *    is blank and the environment already has an auto-adopted name, so editing other fields doesn't
 *    silently reset the label to the DNS.
 * 3. The normalised DNS — the default seeded on add (replaced by the Vault name on first connect).
 */
export function mapFormSubmit(
	submit: EnvironmentFormSubmit,
	existingLabel: string | undefined,
): { input: EnvironmentInput; secret: string | undefined } {
	const customLabel = submit.label?.trim();
	const input: EnvironmentInput = {
		label: customLabel || existingLabel || normalizeDns(submit.vaultDNS),
		hasCustomLabel: !!customLabel,
		vaultDNS: submit.vaultDNS,
		username: submit.username,
		authType: submit.authType,
	};
	const secret = submit.mode === 'edit' && submit.secret === '' ? undefined : submit.secret;
	return { input, secret };
}
