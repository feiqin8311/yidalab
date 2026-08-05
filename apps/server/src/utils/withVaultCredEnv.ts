import type { LobeChatDatabase } from '@lobechat/database';
import { getVaultEnv, runWithVaultEnv } from '@lobechat/utils/server/vaultEnv';
import debug from 'debug';

import { CompanyModel } from '@/database/models/company';
import { UserCredentialModel } from '@/database/models/userCredential';

const log = debug('lobe-server:vault-cred-env');

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
