/**
 * Internal profile: no optional/heavy tool UI packs.
 * Aliased over register.lazy.ts when YIDALAB_BUILD_PROFILE=internal.
 */
export const registerLazyBuiltinToolSurfaces = (): Promise<void> => Promise.resolve();
