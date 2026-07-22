import type { LobeChatDatabase } from '@lobechat/database';

import { CompanyModel } from '@/database/models/company';
import { UserCredentialModel } from '@/database/models/userCredential';

/**
 * Apply personal + company kv-env credentials into `process.env` for one call,
 * then restore. Personal non-empty values already win inside listDecryptedKvEnv.
 *
 * Vault non-empty values win for the duration of `fn` only (then restored), so
 * Settings → Credentials works without restarting the server. Deploy `.env` is
 * the fallback when a vault field is empty/missing.
 */
export async function withVaultCredEnv<T>(
  userId: string | undefined,
  serverDB: LobeChatDatabase | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!userId || !serverDB) return fn();

  const applied = new Map<string, string | undefined>();

  try {
    const company = await new CompanyModel(serverDB, userId).getMyCompany();
    const model = new UserCredentialModel(serverDB, userId);
    const bundles = await model.listDecryptedKvEnv(company?.id ?? null);

    for (const bundle of bundles) {
      for (const [k, v] of Object.entries(bundle.values)) {
        if (typeof v !== 'string' || !v.trim()) continue;
        if (!applied.has(k)) applied.set(k, process.env[k]);
        process.env[k] = v;
      }
    }
  } catch {
    // Missing table / decrypt failure: still run with process env only.
  }

  try {
    return await fn();
  } finally {
    for (const [k, prev] of applied) {
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
  }
}
