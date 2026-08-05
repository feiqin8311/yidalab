import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped vault / credential environment.
 * Prefer this over mutating process.env so concurrent company requests never cross.
 * Falls back to process.env when no ALS store is active (deploy defaults / CLI).
 */
const vaultEnvAls = new AsyncLocalStorage<Record<string, string>>();

export const runWithVaultEnv = <T>(
  env: Record<string, string>,
  fn: () => T | Promise<T>,
): T | Promise<T> => vaultEnvAls.run(env, fn);

/** Read vault-first, then process.env. Never writes process.env. */
export const getVaultEnv = (key: string): string => {
  const fromVault = vaultEnvAls.getStore()?.[key];
  if (typeof fromVault === 'string' && fromVault.trim()) return fromVault.trim();
  return (process.env[key] || '').trim();
};

export const getVaultEnvStore = (): Record<string, string> | undefined => vaultEnvAls.getStore();
