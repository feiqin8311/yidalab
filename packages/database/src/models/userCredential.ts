import type { CredScope, CredType, CredWithPlaintext, UserCredSummary } from '@lobechat/types';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type { NewUserCredential, UserCredentialItem } from '../schemas';
import { userCredentials } from '../schemas';
import type { LobeChatDatabase } from '../type';

const maskValue = (value: string): string => {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
};

const buildMaskedPreview = (values: Record<string, string>): string | undefined => {
  const first = Object.values(values).find((v) => typeof v === 'string' && v.length > 0);
  return first ? maskValue(first) : undefined;
};

const toSummary = (
  row: UserCredentialItem,
  options?: { canManage?: boolean; hideSecrets?: boolean },
): UserCredSummary => {
  const scope: CredScope = row.workspaceId ? 'company' : 'personal';
  const canManage = options?.canManage ?? scope === 'personal';
  return {
    canManage,
    createdAt: row.createdAt.toISOString(),
    description: row.description ?? undefined,
    id: row.id,
    key: row.key,
    lastUsedAt: row.lastUsedAt?.toISOString(),
    // Members see company creds exist, but not masked secret previews.
    maskedPreview: options?.hideSecrets ? undefined : (row.maskedPreview ?? undefined),
    name: row.name,
    scope,
    type: row.type as CredType,
    updatedAt: row.updatedAt.toISOString(),
    visibility: scope === 'company' ? 'public' : 'private',
  };
};

export class UserCredentialModel {
  private userId: string;
  private db: LobeChatDatabase;
  private gateKeeperPromise: Promise<KeyVaultsGateKeeper> | null = null;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private async getGateKeeper() {
    if (!this.gateKeeperPromise) {
      this.gateKeeperPromise = KeyVaultsGateKeeper.initWithEnvKey();
    }
    return this.gateKeeperPromise;
  }

  private personalOwnership = () =>
    and(eq(userCredentials.userId, this.userId), isNull(userCredentials.workspaceId));

  private companyOwnership = (workspaceId: string) => eq(userCredentials.workspaceId, workspaceId);

  private async encryptValues(values: Record<string, string>) {
    const gateKeeper = await this.getGateKeeper();
    return gateKeeper.encrypt(JSON.stringify(values));
  }

  private async decryptValues(encrypted: string | null): Promise<Record<string, string>> {
    if (!encrypted) return {};
    const gateKeeper = await this.getGateKeeper();
    const { plaintext, wasAuthentic } = await gateKeeper.decrypt(encrypted);
    if (!wasAuthentic) throw new Error('Failed to decrypt credential values');
    return JSON.parse(plaintext) as Record<string, string>;
  }

  // ── Personal ────────────────────────────────────────────────────────────

  createPersonalKV = async (params: {
    description?: string;
    key: string;
    name: string;
    type: 'kv-env' | 'kv-header';
    values: Record<string, string>;
  }): Promise<UserCredSummary> => {
    const valuesEncrypted = await this.encryptValues(params.values);
    const [row] = await this.db
      .insert(userCredentials)
      .values({
        description: params.description,
        key: params.key,
        maskedPreview: buildMaskedPreview(params.values),
        name: params.name,
        type: params.type,
        userId: this.userId,
        valuesEncrypted,
        workspaceId: null,
      } satisfies NewUserCredential)
      .returning();
    return toSummary(row, { canManage: true });
  };

  /** @deprecated prefer createPersonalKV / createCompanyKV */
  createKV = this.createPersonalKV;

  listPersonal = async (): Promise<UserCredSummary[]> => {
    const rows = await this.db
      .select()
      .from(userCredentials)
      .where(this.personalOwnership())
      .orderBy(desc(userCredentials.updatedAt));
    return rows.map((row) => toSummary(row, { canManage: true }));
  };

  /** @deprecated prefer listPersonal / listCompany */
  list = this.listPersonal;

  findPersonalByKey = async (key: string): Promise<UserCredentialItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(userCredentials)
      .where(and(this.personalOwnership(), eq(userCredentials.key, key)))
      .limit(1);
    return row;
  };

  findByKey = this.findPersonalByKey;

  findPersonalById = async (id: number): Promise<UserCredentialItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(userCredentials)
      .where(and(this.personalOwnership(), eq(userCredentials.id, id)))
      .limit(1);
    return row;
  };

  findById = this.findPersonalById;

  upsertPersonalKV = async (params: {
    description?: string;
    key: string;
    name: string;
    type: 'kv-env' | 'kv-header';
    values: Record<string, string>;
  }): Promise<UserCredSummary> => {
    const existing = await this.findPersonalByKey(params.key);
    if (existing) {
      const updated = await this.updatePersonal(existing.id, {
        description: params.description,
        name: params.name,
        values: params.values,
      });
      if (updated) return updated;
    }
    return this.createPersonalKV(params);
  };

  upsertKV = this.upsertPersonalKV;

  updatePersonal = async (
    id: number,
    data: { description?: string; name?: string; values?: Record<string, string> },
  ): Promise<UserCredSummary | null> => {
    const patch: Partial<NewUserCredential> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.values) {
      patch.valuesEncrypted = await this.encryptValues(data.values);
      patch.maskedPreview = buildMaskedPreview(data.values);
    }
    if (Object.keys(patch).length === 0) {
      const existing = await this.findPersonalById(id);
      return existing ? toSummary(existing, { canManage: true }) : null;
    }
    const [row] = await this.db
      .update(userCredentials)
      .set(patch)
      .where(and(this.personalOwnership(), eq(userCredentials.id, id)))
      .returning();
    return row ? toSummary(row, { canManage: true }) : null;
  };

  update = this.updatePersonal;

  deletePersonal = async (id: number): Promise<boolean> => {
    const deleted = await this.db
      .delete(userCredentials)
      .where(and(this.personalOwnership(), eq(userCredentials.id, id)))
      .returning({ id: userCredentials.id });
    return deleted.length > 0;
  };

  delete = this.deletePersonal;

  deletePersonalByKey = async (key: string): Promise<boolean> => {
    const deleted = await this.db
      .delete(userCredentials)
      .where(and(this.personalOwnership(), eq(userCredentials.key, key)))
      .returning({ id: userCredentials.id });
    return deleted.length > 0;
  };

  deleteByKey = this.deletePersonalByKey;

  getPersonal = async (
    id: number,
    options?: { decrypt?: boolean },
  ): Promise<CredWithPlaintext | null> => {
    const row = await this.findPersonalById(id);
    if (!row) return null;
    const summary = toSummary(row, { canManage: true });
    if (!options?.decrypt) return summary;
    const plaintext = await this.decryptValues(row.valuesEncrypted);
    return { ...summary, plaintext };
  };

  get = this.getPersonal;

  getPersonalByKey = async (
    key: string,
    options?: { decrypt?: boolean },
  ): Promise<CredWithPlaintext | null> => {
    const row = await this.findPersonalByKey(key);
    if (!row) return null;
    return this.getPersonal(row.id, options);
  };

  getByKey = this.getPersonalByKey;

  // ── Company (workspace-scoped public) ───────────────────────────────────

  listCompany = async (
    workspaceId: string,
    options?: { canManage?: boolean },
  ): Promise<UserCredSummary[]> => {
    const canManage = options?.canManage ?? false;
    const rows = await this.db
      .select()
      .from(userCredentials)
      .where(this.companyOwnership(workspaceId))
      .orderBy(desc(userCredentials.updatedAt));
    return rows.map((row) => toSummary(row, { canManage, hideSecrets: !canManage }));
  };

  findCompanyByKey = async (
    workspaceId: string,
    key: string,
  ): Promise<UserCredentialItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(userCredentials)
      .where(and(this.companyOwnership(workspaceId), eq(userCredentials.key, key)))
      .limit(1);
    return row;
  };

  findCompanyById = async (
    workspaceId: string,
    id: number,
  ): Promise<UserCredentialItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(userCredentials)
      .where(and(this.companyOwnership(workspaceId), eq(userCredentials.id, id)))
      .limit(1);
    return row;
  };

  createCompanyKV = async (
    workspaceId: string,
    params: {
      description?: string;
      key: string;
      name: string;
      type: 'kv-env' | 'kv-header';
      values: Record<string, string>;
    },
  ): Promise<UserCredSummary> => {
    const valuesEncrypted = await this.encryptValues(params.values);
    const [row] = await this.db
      .insert(userCredentials)
      .values({
        description: params.description,
        key: params.key,
        maskedPreview: buildMaskedPreview(params.values),
        name: params.name,
        type: params.type,
        userId: this.userId,
        valuesEncrypted,
        workspaceId,
      } satisfies NewUserCredential)
      .returning();
    return toSummary(row, { canManage: true });
  };

  upsertCompanyKV = async (
    workspaceId: string,
    params: {
      description?: string;
      key: string;
      name: string;
      type: 'kv-env' | 'kv-header';
      values: Record<string, string>;
    },
  ): Promise<UserCredSummary> => {
    const existing = await this.findCompanyByKey(workspaceId, params.key);
    if (existing) {
      const updated = await this.updateCompany(workspaceId, existing.id, {
        description: params.description,
        name: params.name,
        values: params.values,
      });
      if (updated) return updated;
    }
    return this.createCompanyKV(workspaceId, params);
  };

  updateCompany = async (
    workspaceId: string,
    id: number,
    data: { description?: string; name?: string; values?: Record<string, string> },
  ): Promise<UserCredSummary | null> => {
    const patch: Partial<NewUserCredential> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.values) {
      patch.valuesEncrypted = await this.encryptValues(data.values);
      patch.maskedPreview = buildMaskedPreview(data.values);
    }
    if (Object.keys(patch).length === 0) {
      const existing = await this.findCompanyById(workspaceId, id);
      return existing ? toSummary(existing, { canManage: true }) : null;
    }
    const [row] = await this.db
      .update(userCredentials)
      .set(patch)
      .where(and(this.companyOwnership(workspaceId), eq(userCredentials.id, id)))
      .returning();
    return row ? toSummary(row, { canManage: true }) : null;
  };

  deleteCompany = async (workspaceId: string, id: number): Promise<boolean> => {
    const deleted = await this.db
      .delete(userCredentials)
      .where(and(this.companyOwnership(workspaceId), eq(userCredentials.id, id)))
      .returning({ id: userCredentials.id });
    return deleted.length > 0;
  };

  getCompany = async (
    workspaceId: string,
    id: number,
    options?: { decrypt?: boolean },
  ): Promise<CredWithPlaintext | null> => {
    const row = await this.findCompanyById(workspaceId, id);
    if (!row) return null;
    const summary = toSummary(row, { canManage: true });
    if (!options?.decrypt) return summary;
    const plaintext = await this.decryptValues(row.valuesEncrypted);
    return { ...summary, plaintext };
  };

  /**
   * Resolve any credential the user may access by id:
   * personal owned by user, or company-scoped in their workspace.
   */
  findAccessibleById = async (
    id: number,
    companyWorkspaceId?: string | null,
  ): Promise<{ row: UserCredentialItem; scope: CredScope } | null> => {
    const personal = await this.findPersonalById(id);
    if (personal) return { row: personal, scope: 'personal' };
    if (companyWorkspaceId) {
      const company = await this.findCompanyById(companyWorkspaceId, id);
      if (company) return { row: company, scope: 'company' };
    }
    return null;
  };

  /**
   * Decrypt personal + company KV for runtime injection.
   *
   * Priority (same credential `key`, and same env/header name across keys):
   * company provides the baseline; personal **non-empty** values win.
   * Empty personal fields do not wipe company secrets.
   */
  private listDecryptedKv = async (
    type: 'kv-env' | 'kv-header',
    companyWorkspaceId?: string | null,
  ): Promise<Array<{ key: string; values: Record<string, string> }>> => {
    const personalRows = await this.db
      .select()
      .from(userCredentials)
      .where(
        and(
          eq(userCredentials.userId, this.userId),
          isNull(userCredentials.workspaceId),
          eq(userCredentials.type, type),
        ),
      );

    const companyRows = companyWorkspaceId
      ? await this.db
          .select()
          .from(userCredentials)
          .where(
            and(
              eq(userCredentials.workspaceId, companyWorkspaceId),
              eq(userCredentials.type, type),
            ),
          )
      : [];

    const decryptRow = async (row: UserCredentialItem) => {
      try {
        return { key: row.key, values: await this.decryptValues(row.valuesEncrypted) };
      } catch {
        return null;
      }
    };

    const company = (await Promise.all(companyRows.map(decryptRow))).filter(
      (x): x is { key: string; values: Record<string, string> } => !!x,
    );
    const personal = (await Promise.all(personalRows.map(decryptRow))).filter(
      (x): x is { key: string; values: Record<string, string> } => !!x,
    );

    // 1) Same credential key: company base + personal non-empty overrides.
    const byKey = new Map<string, Record<string, string>>();
    for (const item of company) {
      byKey.set(item.key, { ...item.values });
    }
    for (const item of personal) {
      const base = byKey.get(item.key) ?? {};
      const merged = { ...base };
      for (const [k, v] of Object.entries(item.values)) {
        if (typeof v === 'string' && v.trim()) merged[k] = v;
      }
      byKey.set(item.key, merged);
    }

    // 2) Same env/header name across different keys: personal non-empty wins.
    const nameLayer: Record<string, string> = {};
    for (const item of company) {
      for (const [k, v] of Object.entries(item.values)) {
        if (typeof v === 'string' && v.trim()) nameLayer[k] = v;
      }
    }
    for (const item of personal) {
      for (const [k, v] of Object.entries(item.values)) {
        if (typeof v === 'string' && v.trim()) nameLayer[k] = v;
      }
    }

    return [...byKey.entries()].map(([key, values]) => {
      const next = { ...values };
      for (const name of Object.keys(next)) {
        if (nameLayer[name] !== undefined) next[name] = nameLayer[name];
      }
      return { key, values: next };
    });
  };

  /** Decrypt personal + company KV env for runtime injection. */
  listDecryptedKvEnv = async (
    companyWorkspaceId?: string | null,
  ): Promise<Array<{ key: string; values: Record<string, string> }>> => {
    return this.listDecryptedKv('kv-env', companyWorkspaceId);
  };

  /** Decrypt personal + company KV header for runtime injection. */
  listDecryptedKvHeader = async (
    companyWorkspaceId?: string | null,
  ): Promise<Array<{ key: string; values: Record<string, string> }>> => {
    return this.listDecryptedKv('kv-header', companyWorkspaceId);
  };
}
