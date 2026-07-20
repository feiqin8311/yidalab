import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    AUTH_DINGTALK_AGENT_ID: '123456',
    AUTH_DINGTALK_APP_KEY: 'key',
    AUTH_DINGTALK_APP_SECRET: 'secret',
    AUTH_DINGTALK_CORP_ID: 'corp-1',
  },
}));

describe('dingtalk auth service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('isDingTalkAuthConfigured is true when credentials exist', async () => {
    const { isDingTalkAuthConfigured } = await import('./auth');
    expect(isDingTalkAuthConfigured()).toBe(true);
  });

  it('getDingTalkBootstrapConfig returns corpId without secrets', async () => {
    const { getDingTalkBootstrapConfig } = await import('./auth');
    expect(getDingTalkBootstrapConfig()).toEqual({
      agentId: '123456',
      corpId: 'corp-1',
    });
  });

  it('signDingTalkJsapi returns corpId and sha1 signature fields', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('gettoken')) {
        return {
          json: async () => ({ access_token: 'token-1', errcode: 0, expires_in: 7200 }),
          ok: true,
        } as Response;
      }
      if (url.includes('get_jsapi_ticket')) {
        return {
          json: async () => ({ errcode: 0, expires_in: 7200, ticket: 'ticket-1' }),
          ok: true,
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { signDingTalkJsapi } = await import('./auth');
    const pageUrl = 'https://app.example.com/path';
    const sign = await signDingTalkJsapi(pageUrl);

    expect(sign.corpId).toBe('corp-1');
    expect(sign.agentId).toBe('123456');
    expect(sign.timeStamp).toMatch(/^\d+$/);
    expect(sign.nonceStr).toBeTruthy();
    expect(sign.signature).toMatch(/^[a-f0-9]{40}$/);

    const expected = createHash('sha1')
      .update(
        `jsapi_ticket=ticket-1&noncestr=${sign.nonceStr}&timestamp=${sign.timeStamp}&url=${pageUrl}`,
      )
      .digest('hex');
    expect(sign.signature).toBe(expected);
  });
});
