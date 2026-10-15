import type { ConfigReportParameters } from '../../core/configReport/reportParameters';
import type { KeyValueStore } from './types';

const KEY = 'vaultToolbox.configReportSettings';

/** Persists one set of saved Config Report parameters in `globalState` (application-wide, not vault-specific). */
export class ConfigReportSettingsStore {
	constructor(private readonly store: KeyValueStore) {}

	load(): ConfigReportParameters | undefined {
		return this.store.get<ConfigReportParameters>(KEY);
	}

	async save(params: ConfigReportParameters): Promise<void> {
		await this.store.update(KEY, params);
	}
}
