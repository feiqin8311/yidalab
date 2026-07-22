// @vitest-environment node
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

  it('injects vault secrets for the call and restores after', async () => {
    process.env.TAVILY_API_KEY = 'from-env';

    const seen: string[] = [];
    await withVaultCredEnv('user-1', {} as any, async () => {
      seen.push(process.env.TAVILY_API_KEY || '');
    });

    expect(seen).toEqual(['from-vault']);
    expect(process.env.TAVILY_API_KEY).toBe('from-env');
  });

  it('fills missing env from vault without leaving it set', async () => {
    await withVaultCredEnv('user-1', {} as any, async () => {
      expect(process.env.TAVILY_API_KEY).toBe('from-vault');
    });
    expect(process.env.TAVILY_API_KEY).toBeUndefined();
  });

  it('runs fn even when vault load fails', async () => {
    getMyCompany.mockRejectedValue(new Error('db down'));
    const result = await withVaultCredEnv('user-1', {} as any, async () => 'ok');
    expect(result).toBe('ok');
  });
});
