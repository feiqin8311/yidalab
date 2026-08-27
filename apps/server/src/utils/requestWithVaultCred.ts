import type { LobeChatDatabase } from '@lobechat/database';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';

import { injectVaultCreds } from './withVaultCredEnv';

const MAX_BODY_BYTES = 200_000;
const TIMEOUT_MS = 120_000;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

const TOKEN_EXACT = new Set(['APIFY_TOKEN', 'API_KEY', 'TOKEN', 'ACCESS_TOKEN']);

export const headersFromVaultCred = (credentials: {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}): Record<string, string> => {
  const headers: Record<string, string> = { ...(credentials.headers ?? {}) };
  if (hasAuthHeader(headers)) return headers;

  const token = pickToken(credentials.env ?? {});
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

export const assertHttpsUrl = (url: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https URLs are allowed');
  }
  return parsed;
};

const hasAuthHeader = (headers: Record<string, string>): boolean =>
  Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');

const pickToken = (env: Record<string, string>): string | undefined => {
  for (const key of TOKEN_EXACT) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value.trim() && /(_TOKEN|_API_KEY|_KEY)$/i.test(key)) return value.trim();
  }
  const values = Object.values(env)
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length === 1 ? values[0] : undefined;
};

export interface RequestWithVaultCredParams {
  body?: string;
  headers?: Record<string, string>;
  key: string;
  method?: string;
  serverDB: LobeChatDatabase;
  url: string;
  userId: string;
}

export interface RequestWithVaultCredResult {
  body: string;
  status: number;
  truncated: boolean;
}

/**
 * Server-side HTTPS call using a local vault credential.
 * Never returns secret values — only the upstream status + body.
 */
export async function requestWithVaultCred(
  params: RequestWithVaultCredParams,
): Promise<RequestWithVaultCredResult> {
  const method = (params.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error('Unsupported HTTP method');
  }

  assertHttpsUrl(params.url);

  const injected = await injectVaultCreds(params.userId, params.serverDB, [params.key]);
  if (injected.notFound.includes(params.key)) {
    throw new Error(`Credential not found: ${params.key}`);
  }

  const vaultHeaders = headersFromVaultCred(injected.credentials);
  if (Object.keys(vaultHeaders).length === 0) {
    throw new Error(`Credential "${params.key}" has no token or header to attach`);
  }

  const extra = { ...(params.headers ?? {}) };
  delete extra.Authorization;
  delete extra.authorization;

  const headers = { ...extra, ...vaultHeaders };
  const init: RequestInit = {
    headers,
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (params.body && method !== 'GET' && method !== 'HEAD') {
    init.body = params.body;
  }

  const response = await ssrfSafeFetch(params.url, init, { maxContentLength: MAX_BODY_BYTES });
  const body = await response.text();
  return {
    body,
    status: response.status,
    truncated: body.length >= MAX_BODY_BYTES,
  };
}
