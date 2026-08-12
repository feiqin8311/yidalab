/**
 * Bumps when builtin tool UI registries change so React can re-read getBuiltin*.
 * Lazy registration mutates module-level maps; memoized ToolRender must subscribe.
 */
let version = 0;
const listeners = new Set<() => void>();

export const getBuiltinToolRegistryVersion = (): number => version;

export const bumpBuiltinToolRegistryVersion = (): void => {
  version += 1;
  for (const l of listeners) l();
};

export const subscribeBuiltinToolRegistry = (onStoreChange: () => void): (() => void) => {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
};
