// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assertHttpsUrl, headersFromVaultCred } from './requestWithVaultCred';

describe('headersFromVaultCred', () => {
  it('maps APIFY_TOKEN to Authorization Bearer', () => {
    expect(headersFromVaultCred({ env: { APIFY_TOKEN: 'apify_api_x' } })).toEqual({
      Authorization: 'Bearer apify_api_x',
    });
  });

  it('prefers stored headers for kv-header creds', () => {
    expect(
      headersFromVaultCred({
        env: {},
        headers: { Authorization: 'Bearer from-header' },
      }),
    ).toEqual({ Authorization: 'Bearer from-header' });
  });

  it('uses a single env value as bearer token', () => {
    expect(headersFromVaultCred({ env: { TAVILY_API_KEY: 'tvly-x' } })).toEqual({
      Authorization: 'Bearer tvly-x',
    });
  });
});

describe('assertHttpsUrl', () => {
  it('accepts https URLs', () => {
    expect(assertHttpsUrl('https://api.apify.com/v2/users/me').host).toBe('api.apify.com');
  });

  it('rejects http and invalid URLs', () => {
    expect(() => assertHttpsUrl('http://api.apify.com/v2/users/me')).toThrow(/https/);
    expect(() => assertHttpsUrl('not-a-url')).toThrow(/Invalid URL/);
  });
});
