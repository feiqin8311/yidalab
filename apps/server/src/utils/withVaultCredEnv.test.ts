// @vitest-environment node
import { getVaultEnv } from '@lobechat/utils/server/vaultEnv';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withVaultCredEnv } from './withVaultCredEnv';

const getMyCompany = vi.fn();
const listDecryptedKvEnv = vi.fn();

vi.mock('@/database/models/company', () => ({
  CompanyModel: class {
    getMyCompany = getMyCompany;
  },
}));

vi.mock('@/database/models/userCredential', () => ({
  UserCredentialModel: class {
    listDecryptedKvEnv = listDecryptedKvEnv;
  },
}));

describe('withVaultCredEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TAVILY_API_KEY;
    getMyCompany.mockResolvedValue({ id: 'ws-1' });
    listDecryptedKvEnv.mockResolvedValue([
      { key: 'tavily', values: { TAVILY_API_KEY: 'from-vault' } },
    ]);
  });

  it('exposes vault secrets via getVaultEnv without mutating process.env', async () => {
    process.env.TAVILY_API_KEY = 'from-env';

    const seen: string[] = [];
    await withVaultCredEnv('user-1', {} as any, async () => {
      seen.push(getVaultEnv('TAVILY_API_KEY'));
      // process.env must remain deploy default (not overwritten by vault)
      seen.push(process.env.TAVILY_API_KEY || '');
    });

    expect(seen).toEqual(['from-vault', 'from-env']);
    expect(process.env.TAVILY_API_KEY).toBe('from-env');
  });

  it('fills missing process.env via getVaultEnv only inside the call', async () => {
    await withVaultCredEnv('user-1', {} as any, async () => {
      expect(getVaultEnv('TAVILY_API_KEY')).toBe('from-vault');
      expect(process.env.TAVILY_API_KEY).toBeUndefined();
    });
    expect(getVaultEnv('TAVILY_API_KEY')).toBe('');
  });

  it('runs fn even when vault load fails', async () => {
    getMyCompany.mockRejectedValue(new Error('db down'));
    const result = await withVaultCredEnv('user-1', {} as any, async () => 'ok');
    expect(result).toBe('ok');
  });

  it('isolates concurrent company vaults without cross-talk', async () => {
    listDecryptedKvEnv
      .mockResolvedValueOnce([{ key: 'a', values: { TAVILY_API_KEY: 'company-A' } }])
      .mockResolvedValueOnce([{ key: 'b', values: { TAVILY_API_KEY: 'company-B' } }]);

    const seen: string[] = [];
    await Promise.all([
      withVaultCredEnv('user-1', {} as any, async () => {
        await new Promise((r) => setTimeout(r, 20));
        seen.push(getVaultEnv('TAVILY_API_KEY'));
      }),
      withVaultCredEnv('user-2', {} as any, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(getVaultEnv('TAVILY_API_KEY'));
      }),
    ]);

    expect(seen.sort()).toEqual(['company-A', 'company-B'].sort());
    expect(process.env.TAVILY_API_KEY).toBeUndefined();
  });
});
