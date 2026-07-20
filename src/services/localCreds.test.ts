import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import {
  collectMcpSecretValues,
  mcpCredKeyFromIdentifier,
  persistMcpSecretsToLocalCreds,
  upsertLocalKvCred,
} from './localCreds';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    localCreds: {
      createKV: { mutate: vi.fn() },
      getByKey: { query: vi.fn() },
      update: { mutate: vi.fn() },
    },
  },
}));

describe('localCreds MCP helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mcpCredKeyFromIdentifier sanitizes identifier', () => {
    expect(mcpCredKeyFromIdentifier('company.mcp.sif-mcp')).toBe('mcp-company-mcp-sif-mcp');
    expect(mcpCredKeyFromIdentifier('  Foo/Bar  ')).toBe('mcp-foo-bar');
  });

  it('collectMcpSecretValues uses env for stdio', () => {
    expect(
      collectMcpSecretValues({
        config: { API_KEY: 'sk-1' },
        connection: { env: { FOO: 'bar' }, type: 'stdio' },
      }),
    ).toEqual({
      type: 'kv-env',
      values: { API_KEY: 'sk-1', FOO: 'bar' },
    });
  });

  it('collectMcpSecretValues uses headers + bearer for http', () => {
    expect(
      collectMcpSecretValues({
        config: { 'X-Api-Key': 'abc' },
        connection: {
          auth: { token: 'tok', type: 'bearer' },
          headers: { Accept: 'application/json' },
          type: 'http',
        },
      }),
    ).toEqual({
      type: 'kv-header',
      values: {
        'Accept': 'application/json',
        'token': 'tok',
        'X-Api-Key': 'abc',
      },
    });
  });

  it('collectMcpSecretValues returns null when empty', () => {
    expect(collectMcpSecretValues({ connection: { type: 'http' } })).toBeNull();
  });

  it('collectMcpSecretValues extracts secret query params from URL', () => {
    expect(
      collectMcpSecretValues({
        connection: {
          type: 'http',
          url: 'https://mcp.sorftime.com?key=sdhsoetk&other=ignore',
        },
      }),
    ).toEqual({
      type: 'kv-header',
      values: { key: 'sdhsoetk' },
    });
  });

  it('upsertLocalKvCred updates when key exists', async () => {
    vi.mocked(lambdaClient.localCreds.getByKey.query).mockResolvedValue({
      id: 7,
      key: 'mcp-x',
    } as any);

    await upsertLocalKvCred({
      key: 'mcp-x',
      name: 'X',
      type: 'kv-header',
      values: { token: 'a' },
    });

    expect(lambdaClient.localCreds.getByKey.query).toHaveBeenCalledWith({
      key: 'mcp-x',
      scope: 'personal',
    });
    expect(lambdaClient.localCreds.update.mutate).toHaveBeenCalledWith({
      description: undefined,
      id: 7,
      name: 'X',
      values: { token: 'a' },
    });
    expect(lambdaClient.localCreds.createKV.mutate).not.toHaveBeenCalled();
  });

  it('upsertLocalKvCred creates when key is missing', async () => {
    vi.mocked(lambdaClient.localCreds.getByKey.query).mockRejectedValue(new Error('NOT_FOUND'));

    await upsertLocalKvCred({
      key: 'mcp-y',
      name: 'Y',
      type: 'kv-env',
      values: { K: 'v' },
    });

    expect(lambdaClient.localCreds.createKV.mutate).toHaveBeenCalledWith({
      description: undefined,
      key: 'mcp-y',
      name: 'Y',
      scope: 'personal',
      type: 'kv-env',
      values: { K: 'v' },
    });
  });

  it('persistMcpSecretsToLocalCreds is best-effort', async () => {
    vi.mocked(lambdaClient.localCreds.getByKey.query).mockRejectedValue(new Error('NOT_FOUND'));
    vi.mocked(lambdaClient.localCreds.createKV.mutate).mockRejectedValue(new Error('boom'));

    await expect(
      persistMcpSecretsToLocalCreds({
        config: { K: 'v' },
        connection: { type: 'http' },
        identifier: 'company.mcp.demo',
        name: 'Demo',
      }),
    ).resolves.toBeUndefined();
  });
});
