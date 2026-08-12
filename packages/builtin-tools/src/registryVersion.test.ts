import { describe, expect, it, vi } from 'vitest';

import {
  bumpBuiltinToolRegistryVersion,
  getBuiltinToolRegistryVersion,
  subscribeBuiltinToolRegistry,
} from './registryVersion';

describe('builtin tool registryVersion', () => {
  it('notifies subscribers on bump', () => {
    const start = getBuiltinToolRegistryVersion();
    const spy = vi.fn();
    const unsub = subscribeBuiltinToolRegistry(spy);
    bumpBuiltinToolRegistryVersion();
    expect(getBuiltinToolRegistryVersion()).toBe(start + 1);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
    bumpBuiltinToolRegistryVersion();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
