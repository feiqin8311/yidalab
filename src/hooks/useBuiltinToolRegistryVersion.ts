import {
  getBuiltinToolRegistryVersion,
  subscribeBuiltinToolRegistry,
} from '@lobechat/builtin-tools/registryVersion';
import { useSyncExternalStore } from 'react';

/**
 * Subscribe to builtin tool UI registry mutations (eager + lazy packs).
 * Call once near the top of a Tool message tree so children re-read getBuiltin*.
 */
export const useBuiltinToolRegistryVersion = (): number =>
  useSyncExternalStore(
    subscribeBuiltinToolRegistry,
    getBuiltinToolRegistryVersion,
    getBuiltinToolRegistryVersion,
  );
