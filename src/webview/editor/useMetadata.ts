import { useSyncExternalStore } from 'react';
import { metadataStore } from './metadataStoreSingleton';
import type { MetadataSnapshot } from './metadataStore';

/** Bind the app's {@link metadataStore} to React. Zero logic: `useSyncExternalStore` re-renders the
 *  caller whenever the store's snapshot changes. All orchestration lives in the store, not here. */
export function useMetadata(): MetadataSnapshot {
	return useSyncExternalStore(metadataStore.subscribe, metadataStore.getSnapshot);
}
