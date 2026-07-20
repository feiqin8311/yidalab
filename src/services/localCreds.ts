import { lambdaClient } from '@/libs/trpc/client';

/**
 * Market MCP secrets land in plugin settings/connection for connectivity.
 * Also upsert into personal credentials (`/settings/creds`) so they appear
 * in the credential manager.
 */

export type LocalKvCredType = 'kv-env' | 'kv-header';

export const mcpCredKeyFromIdentifier = (identifier: string): string => {
  const slug = identifier
    .trim()
    .toLowerCase()
    .replaceAll(/[^\w-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
  return `mcp-${slug || 'unknown'}`.slice(0, 100);
};

const SECRET_QUERY_KEYS = new Set([
  'key',
  'api_key',
  'apikey',
  'api-key',
  'token',
  'access_token',
  'secret',
  'secret_key',
  'secret-key',
  'password',
  'auth',
]);

const compactStringRecord = (
  input?: Record<string, unknown> | null,
): Record<string, string> | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!key || !trimmed) continue;
    out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** Pull secret-looking query params from an MCP URL (e.g. ?key=...). */
export const extractSecretsFromUrl = (url?: string | null): Record<string, string> | undefined => {
  if (!url?.trim()) return undefined;
  try {
    const parsed = new URL(url);
    const out: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      if (!value.trim()) return;
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) out[key] = value.trim();
    });
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Collect secret KV pairs from MCP install connection + user config form.
 * stdio → env (kv-env); http/cloud → headers + bearer + URL secrets (kv-header).
 */
export const collectMcpSecretValues = (params: {
  config?: Record<string, string> | null;
  connection?: {
    auth?: { token?: string; type?: string };
    env?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    type?: string;
    url?: string;
  } | null;
}): { type: LocalKvCredType; values: Record<string, string> } | null => {
  const config = compactStringRecord(params.config ?? undefined);
  const connection = params.connection;
  const connectionType = connection?.type;

  if (connectionType === 'stdio') {
    const values = {
      ...compactStringRecord(connection?.env),
      ...config,
    };
    if (!values || Object.keys(values).length === 0) return null;
    return { type: 'kv-env', values };
  }

  // http / cloud / unknown with headers, bearer, or URL secrets
  const values: Record<string, string> = {
    ...compactStringRecord(connection?.headers),
    ...extractSecretsFromUrl(connection?.url),
    ...config,
  };

  if (connection?.auth?.type === 'bearer' && connection.auth.token?.trim()) {
    values.token = connection.auth.token.trim();
  }

  if (Object.keys(values).length === 0) return null;
  return { type: 'kv-header', values };
};

export const upsertLocalKvCred = async (params: {
  description?: string;
  key: string;
  name: string;
  /** personal (default). Company keys are owned by the company vault via syncFromMcps. */
  scope?: 'personal' | 'company';
  type: LocalKvCredType;
  values: Record<string, string>;
}): Promise<void> => {
  if (Object.keys(params.values).length === 0) return;
  const scope = params.scope ?? 'personal';

  try {
    const existing = await lambdaClient.localCreds.getByKey.query({ key: params.key, scope });
    await lambdaClient.localCreds.update.mutate({
      description: params.description,
      id: existing!.id,
      name: params.name,
      values: params.values,
    });
  } catch {
    await lambdaClient.localCreds.createKV.mutate({
      description: params.description,
      key: params.key,
      name: params.name,
      scope,
      type: params.type,
      values: params.values,
    });
  }
};

/** Best-effort: never block MCP install if credential vault write fails. */
export const persistMcpSecretsToLocalCreds = async (params: {
  config?: Record<string, string> | null;
  connection?: {
    auth?: { token?: string; type?: string };
    env?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    type?: string;
  } | null;
  identifier: string;
  name?: string;
}): Promise<void> => {
  const collected = collectMcpSecretValues({
    config: params.config,
    connection: params.connection,
  });
  if (!collected) return;

  const key = mcpCredKeyFromIdentifier(params.identifier);
  const displayName = params.name?.trim() || params.identifier;

  try {
    await upsertLocalKvCred({
      description: `MCP: ${params.identifier}`,
      key,
      name: displayName,
      type: collected.type,
      values: collected.values,
    });
  } catch (error) {
    console.error('[localCreds] failed to persist MCP secrets', error);
  }
};
