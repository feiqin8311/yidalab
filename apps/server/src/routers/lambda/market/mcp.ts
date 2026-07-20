import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { getServerDB } from '@/database/core/db-adaptor';
import { CompanyMarketMcpModel } from '@/database/models/companyMarketMcp';
import { router } from '@/libs/trpc/lambda';
import type { DiscoverMcpDetail, DiscoverMcpItem, McpListResponse } from '@/types/discover';

type MarketMcpRow = NonNullable<Awaited<ReturnType<CompanyMarketMcpModel['findByIdentifier']>>> & {
  prompts?: Array<Record<string, unknown>> | null;
  tools?: Array<Record<string, unknown>> | null;
};

const HIDDEN_MCP_TOOLS = new Set(['ping']);

/** Query keys that must never appear in market UI / public deployment config. */
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

const getTools = (row: MarketMcpRow) =>
  (
    (Array.isArray(row.tools) ? row.tools : []) as Array<{
      description?: string;
      inputSchema?: Record<string, unknown>;
      name: string;
    }>
  ).filter((t) => t?.name && !HIDDEN_MCP_TOOLS.has(t.name));

const getPrompts = (row: MarketMcpRow) =>
  (
    (Array.isArray(row.prompts) ? row.prompts : []) as Array<{
      arguments?: Array<{ description?: string; name: string; required?: boolean; type?: string }>;
      description: string;
      name: string;
    }>
  ).filter((p) => p?.name && p?.description);

/** Strip secret query params from URL (e.g. ?key=… on sorftime). */
const redactUrlSecrets = (url?: string): string | undefined => {
  if (!url?.trim()) return url;
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    if (!changed) return url;
    // Drop trailing `?` when no params remain
    const out = parsed.toString();
    return out.endsWith('?') ? out.slice(0, -1) : out;
  } catch {
    // Non-absolute URLs: best-effort strip common secret query fragments
    return url
      .replaceAll(
        /([?&])(key|api_key|apikey|api-key|token|access_token|secret|secret_key|secret-key|password|auth)=[^&#]*/gi,
        '$1',
      )
      .replaceAll(/[?&]$/, '');
  }
};

/**
 * Public market view: type + clean URL only.
 * Secrets live in Settings → Credentials; never echo headers / auth / query keys.
 * Install path may pass `includeSecrets: true` so the agent can still connect once.
 */
const toPublicConnection = (
  connection: MarketMcpRow['connection'] | undefined,
  options?: { includeSecrets?: boolean },
) => {
  const conn = connection || { type: 'http' as const };
  const type = conn.type === 'stdio' ? 'stdio' : 'http';

  if (options?.includeSecrets) {
    return {
      type,
      url: conn.url,
      ...(conn.headers ? { headers: conn.headers } : {}),
      ...(conn.auth ? { auth: conn.auth } : {}),
      ...(conn.type === 'stdio' && (conn as any).env ? { env: (conn as any).env } : {}),
    } as any;
  }

  return {
    type,
    // Redact secrets from URL; never return headers / auth tokens on market pages
    url: redactUrlSecrets(conn.url),
  } as any;
};

const toDeployment = (row: MarketMcpRow, options?: { includeSecrets?: boolean }) => {
  return {
    connection: toPublicConnection(row.connection, options),
    installationMethod: 'http',
    isRecommended: true,
  };
};

const toItem = (row: MarketMcpRow): DiscoverMcpItem => {
  const now = row.updatedAt?.toISOString?.() || new Date().toISOString();
  const created = row.createdAt?.toISOString?.() || now;
  const tools = getTools(row);
  const prompts = getPrompts(row);
  return {
    author: 'Company',
    capabilities: {
      prompts: prompts.length > 0,
      resources: false,
      tools: tools.length > 0,
    },
    category: row.category || undefined,
    commentCount: 0,
    connectionType: 'remote',
    createdAt: created,
    description: row.description,
    homepage: row.identifier === 'company.mcp.sif-mcp' ? 'https://mcp.sif.com/' : undefined,
    icon: row.icon || undefined,
    identifier: row.identifier,
    installCount: 0,
    installationMethods: 'http',
    isClaimed: false,
    isFeatured: false,
    isOfficial: row.identifier === 'company.mcp.sif-mcp',
    isValidated: true,
    // install flow accepts empty manifestUrl and falls back to getMcpDetail
    manifestUrl: `company://${row.identifier}`,
    name: row.name,
    promptsCount: prompts.length,
    ratingCount: 0,
    tags: row.tags || [],
    toolsCount: tools.length,
    updatedAt: now,
  } as DiscoverMcpItem;
};

const toDetail = (row: MarketMcpRow): DiscoverMcpDetail => {
  const item = toItem(row);
  const tools = getTools(row);
  const prompts = getPrompts(row);
  return {
    ...item,
    author: { name: 'Company' },
    // Market detail UI never receives secrets
    deploymentOptions: [toDeployment(row, { includeSecrets: false })],
    overview: {
      // Prefer a non-empty description so score `readme` (required) is satisfied
      // on both list (via description fallback) and detail pages.
      readme: row.description || row.name,
      summary: row.description || row.name,
    },
    prompts,
    related: [],
    tools,
    version: '1.0.0',
    versions: [{ createdAt: item.updatedAt, isLatest: true, version: '1.0.0' }],
  } as DiscoverMcpDetail;
};

const toManifest = (row: MarketMcpRow, options?: { includeSecrets?: boolean }) => {
  const tools = getTools(row);
  const prompts = getPrompts(row);
  return {
    // LobeChat install path: prefer tools (MCP) or api (LobeChat)
    api: tools.map((t) => ({
      description: t.description || '',
      name: t.name,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    })),
    author: { name: 'Company' },
    capabilities: {
      prompts: prompts.length > 0,
      resources: false,
      tools: tools.length > 0,
    },
    category: row.category || undefined,
    createdAt: row.createdAt?.toISOString?.() || new Date().toISOString(),
    deploymentOptions: [toDeployment(row, options)],
    description: row.description,
    icon: row.icon || undefined,
    identifier: row.identifier,
    name: row.name,
    overview: { readme: row.description, summary: row.description },
    prompts,
    tags: row.tags || [],
    tools,
    updatedAt: row.updatedAt?.toISOString?.() || new Date().toISOString(),
    version: '1.0.0',
  };
};

export const companyMcpHelpers = {
  async getCategories(q?: string) {
    const db = await getServerDB();
    // list across all company workspaces for public market listing
    const rows = await CompanyMarketMcpModel.listAll(db);
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (
        q &&
        !`${row.name} ${row.description} ${row.identifier}`.toLowerCase().includes(q.toLowerCase())
      )
        continue;
      const cat = row.category || 'tools';
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  },

  async getDetail(identifier: string): Promise<DiscoverMcpDetail | null> {
    const db = await getServerDB();
    const row = await CompanyMarketMcpModel.findByIdentifierGlobal(db, identifier);
    return row ? toDetail(row) : null;
  },

  async getList(params: {
    category?: string;
    page?: number;
    pageSize?: number;
    q?: string;
  }): Promise<McpListResponse> {
    const db = await getServerDB();
    let rows = await CompanyMarketMcpModel.listAll(db);
    if (params.category && params.category !== 'all' && params.category !== 'discover') {
      rows = rows.filter((r) => r.category === params.category);
    }
    if (params.q?.trim()) {
      const q = params.q.trim().toLowerCase();
      rows = rows.filter((r) =>
        `${r.name} ${r.description} ${r.identifier}`.toLowerCase().includes(q),
      );
    }
    const page = Math.max(params.page || 1, 1);
    const pageSize = Math.min(Math.max(params.pageSize || 21, 1), 100);
    const totalCount = rows.length;
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map(toItem);
    return {
      categories: [...new Set(rows.map((r) => r.category).filter(Boolean))] as string[],
      currentPage: page,
      items,
      pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    };
  },

  async getManifest(identifier: string, options?: { includeSecrets?: boolean }) {
    const db = await getServerDB();
    const row = await CompanyMarketMcpModel.findByIdentifierGlobal(db, identifier);
    // Default: redacted for market UI. Pass includeSecrets only for install flow.
    return row ? toManifest(row, { includeSecrets: options?.includeSecrets === true }) : null;
  },
};

// Optional authenticated CRUD (workspace-scoped) — list is public via companyMcpHelpers
export const companyMcpRouter = router({
  list: wsCompatProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'NO_WORKSPACE' });
      const model = new CompanyMarketMcpModel(ctx.serverDB, ctx.workspaceId);
      const result = await model.list(input || {});
      return {
        currentPage: result.currentPage,
        items: result.items.map(toItem),
        pageSize: result.pageSize,
        totalCount: result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
      };
    }),
});
