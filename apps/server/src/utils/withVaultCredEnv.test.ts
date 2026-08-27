// @vitest-environment node
import { getVaultEnv } from '@lobechat/utils/server/vaultEnv';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectVaultCreds, listVaultCredSummaries, withVaultCredEnv } from './withVaultCredEnv';

const getMyCompany = vi.fn();
const listDecryptedKvEnv = vi.fn();
const listDecryptedKvHeader = vi.fn();
const listPersonal = vi.fn();
const listCompany = vi.fn();

vi.mock('@/database/models/company', () => ({
  CompanyModel: class {
    getMyCompany = getMyCompany;
  },
}));

vi.mock('@/database/models/userCredential', () => ({
  UserCredentialModel: class {
    listCompany = listCompany;
    listDecryptedKvEnv = listDecryptedKvEnv;
    listDecryptedKvHeader = listDecryptedKvHeader;
    listPersonal = listPersonal;
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
    listDecryptedKvHeader.mockResolvedValue([]);
    listPersonal.mockResolvedValue([]);
    listCompany.mockResolvedValue([]);
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

describe('listVaultCredSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyCompany.mockResolvedValue({ id: 'ws-1' });
    listPersonal.mockResolvedValue([
      {
        description: 'personal openai',
        key: 'openai',
        name: 'OpenAI',
        scope: 'personal',
        type: 'kv-env',
      },
    ]);
    listCompany.mockResolvedValue([
      {
        description: 'Env: APIFY_TOKEN',
        key: 'apify',
        name: 'Apify',
        scope: 'company',
        type: 'kv-env',
      },
    ]);
  });

  it('merges company then personal credentials from the local vault', async () => {
    const rows = await listVaultCredSummaries('user-1', {} as any);
    expect(rows.map((r) => r.key)).toEqual(['apify', 'openai']);
  });

  it('returns [] when vault load fails', async () => {
    getMyCompany.mockRejectedValue(new Error('db down'));
    await expect(listVaultCredSummaries('user-1', {} as any)).resolves.toEqual([]);
  });
});

describe('injectVaultCreds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyCompany.mockResolvedValue({ id: 'ws-1' });
    listDecryptedKvEnv.mockResolvedValue([
      { key: 'apify', values: { APIFY_TOKEN: 'apify_api_test' } },
      { key: 'tavily', values: { TAVILY_API_KEY: 'tvly-test' } },
    ]);
    listDecryptedKvHeader.mockResolvedValue([]);
  });

  it('decrypts selected kv-env keys including company vault', async () => {
    const result = await injectVaultCreds('user-1', {} as any, ['apify']);
    expect(result).toEqual({
      credentials: { env: { APIFY_TOKEN: 'apify_api_test' }, files: [], headers: {} },
      notFound: [],
      success: true,
      unsupportedInSandbox: [],
    });
  });

  it('reports missing keys', async () => {
    const result = await injectVaultCreds('user-1', {} as any, ['apify', 'missing']);
    expect(result.success).toBe(false);
    expect(result.notFound).toEqual(['missing']);
    expect(result.credentials.env).toEqual({ APIFY_TOKEN: 'apify_api_test' });
  });
});
