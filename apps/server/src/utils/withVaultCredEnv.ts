import type { LobeChatDatabase } from '@lobechat/database';
import type { UserCredSummary } from '@lobechat/types';
import { getVaultEnv, runWithVaultEnv } from '@lobechat/utils/server/vaultEnv';
import debug from 'debug';

import { CompanyModel } from '@/database/models/company';
import { UserCredentialModel } from '@/database/models/userCredential';

const log = debug('lobe-server:vault-cred-env');

const compactKv = (values: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  return out;
};

/**
 * Load personal + company kv-env credentials into a request-scoped map.
 * Personal non-empty values already win inside listDecryptedKvEnv.
 * Deploy `.env` remains the fallback via getVaultEnv → process.env.
 */
export async function loadVaultEnvMap(
  userId: string | undefined,
  serverDB: LobeChatDatabase | undefined,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (!userId || !serverDB) return map;

  try {
    const company = await new CompanyModel(serverDB, userId).getMyCompany();
    const model = new UserCredentialModel(serverDB, userId);
    const bundles = await model.listDecryptedKvEnv(company?.id ?? null);

    for (const bundle of bundles) {
      for (const [k, v] of Object.entries(bundle.values)) {
        if (typeof v !== 'string' || !v.trim()) continue;
        map[k] = v;
      }
    }
  } catch (error) {
    // Never log message/body — may carry vault material. Type-only fingerprint.
    log(
      'loadVaultEnvMap failed userId=%s err=%s',
      userId,
      error instanceof Error ? error.name || 'Error' : typeof error,
    );
  }

  return map;
}

/**
 * Metadata-only list of personal + company credentials (no plaintext).
 * Same rows the Settings → Credentials page shows via `localCreds.list`.
 */
export async function listVaultCredSummaries(
  userId: string | undefined,
  serverDB: LobeChatDatabase | undefined,
): Promise<UserCredSummary[]> {
  if (!userId || !serverDB) return [];

  try {
    const company = await new CompanyModel(serverDB, userId).getMyCompany();
    const model = new UserCredentialModel(serverDB, userId);
    const personal = await model.listPersonal();
    const companyRows = company?.id ? await model.listCompany(company.id) : [];
    return [...companyRows, ...personal];
  } catch (error) {
    log(
      'listVaultCredSummaries failed userId=%s err=%s',
      userId,
      error instanceof Error ? error.name || 'Error' : typeof error,
    );
    return [];
  }
}

export interface InjectVaultCredsResult {
  credentials: {
    env: Record<string, string>;
    files: Array<{ filename: string; key: string; path: string }>;
    headers: Record<string, string>;
  };
  notFound: string[];
  success: boolean;
  unsupportedInSandbox: string[];
}

/**
 * Decrypt selected local vault keys (personal + company) for server-side inject.
 * Company plaintext stays on the server — do not expose this via client TRPC.
 */
export async function injectVaultCreds(
  userId: string | undefined,
  serverDB: LobeChatDatabase | undefined,
  keys: string[],
): Promise<InjectVaultCredsResult> {
  const empty: InjectVaultCredsResult = {
    credentials: { env: {}, files: [], headers: {} },
    notFound: [...keys],
    success: keys.length === 0,
    unsupportedInSandbox: [],
  };
  if (!userId || !serverDB || keys.length === 0) return empty;

  try {
    const company = await new CompanyModel(serverDB, userId).getMyCompany();
    const model = new UserCredentialModel(serverDB, userId);
    const [envItems, headerItems] = await Promise.all([
      model.listDecryptedKvEnv(company?.id ?? null),
      model.listDecryptedKvHeader(company?.id ?? null),
    ]);

    const keySet = new Set(keys);
    const env: Record<string, string> = {};
    const headers: Record<string, string> = {};
    const found = new Set<string>();

    for (const item of envItems) {
      if (!keySet.has(item.key)) continue;
      found.add(item.key);
      Object.assign(env, compactKv(item.values));
    }
    for (const item of headerItems) {
      if (!keySet.has(item.key)) continue;
      found.add(item.key);
      Object.assign(headers, compactKv(item.values));
    }

    const notFound = keys.filter((k) => !found.has(k));
    return {
      credentials: { env, files: [], headers },
      notFound,
      success: notFound.length === 0,
      unsupportedInSandbox: [],
    };
  } catch (error) {
    log(
      'injectVaultCreds failed userId=%s err=%s',
      userId,
      error instanceof Error ? error.name || 'Error' : typeof error,
    );
    return empty;
  }
}

/**
 * Run `fn` with request-scoped vault credentials (AsyncLocalStorage).
 * Does **not** mutate process.env — concurrent company requests cannot cross.
 *
 * Consumers must use getVaultEnv from @lobechat/utils/server (not root export).
 */
export async function withVaultCredEnv<T>(
  userId: string | undefined,
  serverDB: LobeChatDatabase | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!userId || !serverDB) return fn();

  const vault = await loadVaultEnvMap(userId, serverDB);
  return runWithVaultEnv(vault, fn) as Promise<T>;
}

export { getVaultEnv, runWithVaultEnv };
