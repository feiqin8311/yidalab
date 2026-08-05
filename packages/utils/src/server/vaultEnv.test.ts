import { describe, expect, it } from 'vitest';

import { getVaultEnv, runWithVaultEnv } from './vaultEnv';

describe('vaultEnv ALS', () => {
  it('falls back to process.env outside ALS', () => {
    process.env.TEST_VAULT_KEY = 'deploy';
    expect(getVaultEnv('TEST_VAULT_KEY')).toBe('deploy');
    delete process.env.TEST_VAULT_KEY;
  });

  it('prefers ALS vault over process.env', async () => {
    process.env.TEST_VAULT_KEY = 'deploy';
    await runWithVaultEnv({ TEST_VAULT_KEY: 'vault' }, async () => {
      expect(getVaultEnv('TEST_VAULT_KEY')).toBe('vault');
      expect(process.env.TEST_VAULT_KEY).toBe('deploy');
    });
    expect(getVaultEnv('TEST_VAULT_KEY')).toBe('deploy');
    delete process.env.TEST_VAULT_KEY;
  });

  it('isolates nested concurrent stores', async () => {
    const a = runWithVaultEnv({ K: 'A' }, async () => {
      await new Promise((r) => setTimeout(r, 15));
      return getVaultEnv('K');
    });
    const b = runWithVaultEnv({ K: 'B' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getVaultEnv('K');
    });
    expect((await Promise.all([a, b])).sort()).toEqual(['A', 'B']);
  });
});
