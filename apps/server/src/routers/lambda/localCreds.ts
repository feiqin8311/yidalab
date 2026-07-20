import { DingpanPersonalCredEnvKeys, DingpanPersonalCredKey } from '@lobechat/builtin-tool-dingpan';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { CompanyModel } from '@/database/models/company';
import { CompanyMarketMcpModel } from '@/database/models/companyMarketMcp';
import { UserCredentialModel } from '@/database/models/userCredential';
import { userInstalledPlugins } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

/** Ensure each user has a personal dingpan credential template (path differs per person). */
const ensurePersonalDingpanCredential = async (model: UserCredentialModel) => {
  const existing = await model.findPersonalByKey(DingpanPersonalCredKey);
  if (existing) return;

  const values = Object.fromEntries(DingpanPersonalCredEnvKeys.map((k) => [k, ''])) as Record<
    string,
    string
  >;

  await model.createPersonalKV({
    description:
      'Personal DingTalk Drive (钉盘). Fill APP_KEY/SECRET, your UNION_ID, and your folder link — each person has a different path.',
    key: DingpanPersonalCredKey,
    name: 'DingTalk Drive (钉盘)',
    type: 'kv-env',
    values,
  });
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

const extractSecretsFromUrl = (url?: string | null): Record<string, string> | undefined => {
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

const mcpCredKeyFromIdentifier = (identifier: string): string => {
  const slug = identifier
    .trim()
    .toLowerCase()
    .replaceAll(/[^\w-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
  return `mcp-${slug || 'unknown'}`.slice(0, 100);
};

const collectMcpSecrets = (
  connection?: {
    auth?: { token?: string; type?: string };
    env?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    type?: string;
    url?: string;
  } | null,
): { type: 'kv-env' | 'kv-header'; values: Record<string, string> } | null => {
  if (!connection) return null;
  if (connection.type === 'stdio') {
    const values = compactStringRecord(connection.env);
    return values ? { type: 'kv-env', values } : null;
  }
  const values: Record<string, string> = {
    ...compactStringRecord(connection.headers),
    ...extractSecretsFromUrl(connection.url),
  };
  if (connection.auth?.type === 'bearer' && connection.auth.token?.trim()) {
    values.token = connection.auth.token.trim();
  }
  return Object.keys(values).length > 0 ? { type: 'kv-header', values } : null;
};

/**
 * Local personal + company credentials API for the settings/creds UI.
 */
const localCredsProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const company = await new CompanyModel(ctx.serverDB, ctx.userId).getMyCompany();
  const canManageCompany = company?.role === 'admin' || company?.role === 'owner';
  return opts.next({
    ctx: {
      canManageCompany: !!canManageCompany,
      companyWorkspaceId: company?.id ?? null,
      userCredentialModel: new UserCredentialModel(ctx.serverDB, ctx.userId),
    },
  });
});

const keySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/);

const kvCreateSchema = z.object({
  description: z.string().optional(),
  key: keySchema,
  name: z.string().min(1).max(255),
  /** personal (default) | company — company requires admin/owner */
  scope: z.enum(['personal', 'company']).optional().default('personal'),
  type: z.enum(['kv-env', 'kv-header']),
  values: z.record(z.string(), z.string()),
});

export const localCredsRouter = router({
  createFile: localCredsProcedure
    .input(
      z.object({
        description: z.string().optional(),
        fileHashId: z.string().length(64),
        fileName: z.string().min(1),
        key: z.string().min(1).max(100),
        name: z.string().min(1).max(255),
        scope: z.enum(['personal', 'company']).optional().default('personal'),
      }),
    )
    .mutation(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Local file credentials are not implemented yet. Use kv-env / kv-header.',
      });
    }),

  createKV: localCredsProcedure.input(kvCreateSchema).mutation(async ({ ctx, input }) => {
    const scope = input.scope ?? 'personal';

    if (scope === 'company') {
      if (!ctx.companyWorkspaceId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'NO_COMPANY' });
      }
      if (!ctx.canManageCompany) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
      }
      const existing = await ctx.userCredentialModel.findCompanyByKey(
        ctx.companyWorkspaceId,
        input.key,
      );
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Credential key already exists: ${input.key}`,
        });
      }
      return ctx.userCredentialModel.createCompanyKV(ctx.companyWorkspaceId, {
        description: input.description,
        key: input.key,
        name: input.name,
        type: input.type,
        values: input.values,
      });
    }

    const existing = await ctx.userCredentialModel.findPersonalByKey(input.key);
    if (existing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Credential key already exists: ${input.key}`,
      });
    }
    return ctx.userCredentialModel.createPersonalKV({
      description: input.description,
      key: input.key,
      name: input.name,
      type: input.type,
      values: input.values,
    });
  }),

  createOAuth: localCredsProcedure
    .input(
      z.object({
        description: z.string().optional(),
        key: z.string().min(1).max(100),
        name: z.string().min(1).max(255),
        oauthConnectionId: z.number(),
      }),
    )
    .mutation(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Local OAuth credentials are not implemented yet. Use kv-env / kv-header.',
      });
    }),

  delete: localCredsProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const accessible = await ctx.userCredentialModel.findAccessibleById(
        input.id,
        ctx.companyWorkspaceId,
      );
      if (!accessible) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });

      if (accessible.scope === 'company') {
        if (!ctx.canManageCompany || !ctx.companyWorkspaceId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
        }
        const ok = await ctx.userCredentialModel.deleteCompany(ctx.companyWorkspaceId, input.id);
        if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
        return { success: true };
      }

      const ok = await ctx.userCredentialModel.deletePersonal(input.id);
      if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      return { success: true };
    }),

  deleteByKey: localCredsProcedure
    .input(
      z.object({
        key: z.string(),
        scope: z.enum(['personal', 'company']).optional().default('personal'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scope === 'company') {
        if (!ctx.canManageCompany || !ctx.companyWorkspaceId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
        }
        const row = await ctx.userCredentialModel.findCompanyByKey(
          ctx.companyWorkspaceId,
          input.key,
        );
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
        await ctx.userCredentialModel.deleteCompany(ctx.companyWorkspaceId, row.id);
        return { success: true };
      }
      const ok = await ctx.userCredentialModel.deletePersonalByKey(input.key);
      if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      return { success: true };
    }),

  get: localCredsProcedure
    .input(
      z.object({
        decrypt: z.boolean().optional(),
        id: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const accessible = await ctx.userCredentialModel.findAccessibleById(
        input.id,
        ctx.companyWorkspaceId,
      );
      if (!accessible) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });

      if (accessible.scope === 'company') {
        if (input.decrypt && !ctx.canManageCompany) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
        }
        if (!ctx.companyWorkspaceId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
        }
        // Members may only fetch metadata (no decrypt)
        const result = await ctx.userCredentialModel.getCompany(ctx.companyWorkspaceId, input.id, {
          decrypt: input.decrypt && ctx.canManageCompany,
        });
        if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
        if (!ctx.canManageCompany) {
          return { ...result, canManage: false, maskedPreview: undefined, plaintext: undefined };
        }
        return { ...result, canManage: true };
      }

      const result = await ctx.userCredentialModel.getPersonal(input.id, {
        decrypt: input.decrypt,
      });
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      return result;
    }),

  getByKey: localCredsProcedure
    .input(
      z.object({
        decrypt: z.boolean().optional(),
        key: z.string(),
        scope: z.enum(['personal', 'company']).optional().default('personal'),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.scope === 'company') {
        if (!ctx.companyWorkspaceId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
        }
        if (input.decrypt && !ctx.canManageCompany) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
        }
        const row = await ctx.userCredentialModel.findCompanyByKey(
          ctx.companyWorkspaceId,
          input.key,
        );
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
        return ctx.userCredentialModel.getCompany(ctx.companyWorkspaceId, row.id, {
          decrypt: input.decrypt && ctx.canManageCompany,
        });
      }

      const result = await ctx.userCredentialModel.getPersonalByKey(input.key, {
        decrypt: input.decrypt,
      });
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      return result;
    }),

  getSkillCredStatus: localCredsProcedure
    .input(z.object({ skillIdentifier: z.string() }))
    .query(async () => {
      return [];
    }),

  inject: localCredsProcedure
    .input(
      z.object({
        keys: z.array(z.string()),
        sandbox: z.boolean().optional().default(true),
        topicId: z.string(),
        userId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // All company members can *use* company secrets at runtime; only managers view them in UI.
      const [envItems, headerItems] = await Promise.all([
        ctx.userCredentialModel.listDecryptedKvEnv(ctx.companyWorkspaceId),
        ctx.userCredentialModel.listDecryptedKvHeader(ctx.companyWorkspaceId),
      ]);
      const keySet = new Set(input.keys);
      const env: Record<string, string> = {};
      const headers: Record<string, string> = {};
      const found = new Set<string>();
      for (const item of envItems) {
        if (!keySet.has(item.key)) continue;
        found.add(item.key);
        Object.assign(env, item.values);
      }
      for (const item of headerItems) {
        if (!keySet.has(item.key)) continue;
        found.add(item.key);
        Object.assign(headers, item.values);
      }
      const notFound = input.keys.filter((k) => !found.has(k));
      return {
        credentials: { env, files: [], headers },
        notFound,
        success: notFound.length === 0,
        unsupportedInSandbox: [],
      };
    }),

  injectForSkill: localCredsProcedure
    .input(
      z.object({
        sandbox: z.boolean().optional().default(true),
        skillIdentifier: z.string(),
      }),
    )
    .mutation(async () => {
      return {
        credentials: { env: {}, files: [], headers: {} },
        missing: [],
        success: true,
        unsupportedInSandbox: [],
      };
    }),

  list: localCredsProcedure.query(async ({ ctx }) => {
    // Every member gets a personal dingpan template (folder path differs per user).
    await ensurePersonalDingpanCredential(ctx.userCredentialModel);

    const personal = await ctx.userCredentialModel.listPersonal();
    const company = ctx.companyWorkspaceId
      ? await ctx.userCredentialModel.listCompany(ctx.companyWorkspaceId, {
          canManage: ctx.canManageCompany,
        })
      : [];

    return {
      canManageCompany: ctx.canManageCompany,
      companyWorkspaceId: ctx.companyWorkspaceId,
      data: [...company, ...personal],
    };
  }),

  /**
   * Backfill market MCP catalog secrets → company vault (shared).
   * User-installed MCP secrets not in the catalog → personal vault.
   */
  syncFromMcps: localCredsProcedure.mutation(async ({ ctx }) => {
    await ensurePersonalDingpanCredential(ctx.userCredentialModel);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const seenCompanyKeys = new Set<string>();
    const seenPersonalKeys = new Set<string>();

    // 1) Company market MCP catalog → company credentials (shared by whole company)
    if (ctx.companyWorkspaceId) {
      const marketRows = await CompanyMarketMcpModel.listAll(ctx.serverDB);
      for (const row of marketRows) {
        const collected = collectMcpSecrets(row.connection as any);
        if (!collected) {
          skipped += 1;
          continue;
        }
        const key = mcpCredKeyFromIdentifier(row.identifier);
        if (seenCompanyKeys.has(key)) continue;
        seenCompanyKeys.add(key);

        const existing = await ctx.userCredentialModel.findCompanyByKey(
          ctx.companyWorkspaceId,
          key,
        );
        // Members can seed missing company rows so runtime inject works;
        // only managers refresh values on existing rows.
        if (existing && !ctx.canManageCompany) {
          skipped += 1;
          continue;
        }
        await ctx.userCredentialModel.upsertCompanyKV(ctx.companyWorkspaceId, {
          description: `MCP: ${row.identifier}`,
          key,
          name: row.name,
          type: collected.type,
          values: collected.values,
        });
        // Remove accidental personal copies of the same market MCP key
        await ctx.userCredentialModel.deletePersonalByKey(key);
        if (existing) updated += 1;
        else created += 1;
      }
    }

    // 2) Installed plugins that are not company-market catalog entries → personal
    const installed = await ctx.serverDB
      .select({
        customParams: userInstalledPlugins.customParams,
        identifier: userInstalledPlugins.identifier,
        manifest: userInstalledPlugins.manifest,
      })
      .from(userInstalledPlugins)
      .where(eq(userInstalledPlugins.userId, ctx.userId));

    for (const row of installed) {
      if (seenCompanyKeys.has(mcpCredKeyFromIdentifier(row.identifier))) continue;
      const mcp = (row.customParams as any)?.mcp;
      if (!mcp) continue;
      const collected = collectMcpSecrets(mcp);
      if (!collected) {
        skipped += 1;
        continue;
      }
      const key = mcpCredKeyFromIdentifier(row.identifier);
      if (seenPersonalKeys.has(key)) continue;
      seenPersonalKeys.add(key);

      const existing = await ctx.userCredentialModel.findPersonalByKey(key);
      await ctx.userCredentialModel.upsertPersonalKV({
        description: `MCP: ${row.identifier}`,
        key,
        name: (row.manifest as any)?.meta?.title || (row.manifest as any)?.name || row.identifier,
        type: collected.type,
        values: collected.values,
      });
      if (existing) updated += 1;
      else created += 1;
    }

    return { created, skipped, synced: created + updated, updated };
  }),

  listOAuthConnections: localCredsProcedure.query(async () => {
    return { connections: [] };
  }),

  publish: localCredsProcedure.input(z.object({ id: z.number() })).mutation(async () => {
    throw new TRPCError({
      code: 'NOT_IMPLEMENTED',
      message: 'Sharing credentials is not available in local mode',
    });
  }),

  share: localCredsProcedure
    .input(
      z.object({
        id: z.number(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Sharing credentials is not available in local mode',
      });
    }),

  unshare: localCredsProcedure.input(z.object({ id: z.number() })).mutation(async () => {
    throw new TRPCError({
      code: 'NOT_IMPLEMENTED',
      message: 'Sharing credentials is not available in local mode',
    });
  }),

  update: localCredsProcedure
    .input(
      z.object({
        description: z.string().optional(),
        id: z.number(),
        name: z.string().optional(),
        values: z.record(z.string(), z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const accessible = await ctx.userCredentialModel.findAccessibleById(
        id,
        ctx.companyWorkspaceId,
      );
      if (!accessible) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });

      if (accessible.scope === 'company') {
        if (!ctx.canManageCompany || !ctx.companyWorkspaceId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
        }
        const result = await ctx.userCredentialModel.updateCompany(
          ctx.companyWorkspaceId,
          id,
          data,
        );
        if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
        return result;
      }

      const result = await ctx.userCredentialModel.updatePersonal(id, data);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' });
      return result;
    }),

  uploadFile: localCredsProcedure
    .input(
      z.object({
        file: z.string(),
        fileName: z.string().min(1),
        fileType: z.string().min(1),
      }),
    )
    .mutation(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Local file credential upload is not implemented yet',
      });
    }),
});
