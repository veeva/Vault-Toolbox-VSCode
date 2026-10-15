/**
 * Pure label-normalization for Vault API metadata (query targets and their fields). `SHOW TARGETS` and
 * `SHOW FIELDS` sometimes return a real human label (e.g. `Access Request`) and sometimes echo the raw
 * API name (e.g. `active_workflow__sys`). When the label is just the name, we derive a readable label
 * from it: drop the trailing `__suffix`, split on underscores, and title-case each word
 * (`active_workflow__sys` -> `Active Workflow`). A label that differs from the name is left untouched.
 * Kept vscode-free so it can be unit-tested and reused wherever API labels are built.
 */

/**
 * Return a display label for an API metadata row. When `label` exactly equals `name`, the name is
 * humanized; otherwise the original label is returned unchanged. Never returns an empty string — if
 * humanizing yields nothing, the original label is used as a fallback.
 */
export function displayLabel(name: string, label: string | undefined): string | undefined {
	if (label !== name) {
		return label;
	}
	const humanized = humanizeApiName(name);
	return humanized.length > 0 ? humanized : label;
}

/** Turn a Vault API name like `active_workflow__sys` into a title-cased label like `Active Workflow`. */
function humanizeApiName(apiName: string): string {
	return stripSuffix(apiName)
		.split('_')
		.filter((word) => word.length > 0)
		.map(capitalizeFirst)
		.join(' ');
}

/** Remove the trailing `__suffix` (e.g. `__sys`, `__c`, `__v`) starting at the final double underscore. */
function stripSuffix(apiName: string): string {
	const suffixStart = apiName.lastIndexOf('__');
	return suffixStart === -1 ? apiName : apiName.slice(0, suffixStart);
}

function capitalizeFirst(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}
