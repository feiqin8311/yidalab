import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';

import type { ResourceGrantType } from '../schemas/resourceGrant';
import { workspaceMembers } from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';

export type ResourceListScope = 'mine' | 'shared_with_me' | 'workspace' | 'admin_all';

export interface ResourceAccessContext {
  departmentId: string | null;
  isAdmin: boolean;
  userId: string;
  workspaceId: string;
}

/**
 * Load membership flags used by resource list/read predicates.
 */
export async function loadResourceAccessContext(
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
): Promise<ResourceAccessContext | null> {
  if (!workspaceId) return null;

  const member = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
      isNull(workspaceMembers.deletedAt),
    ),
  });

  return {
    departmentId: member?.departmentId ?? null,
    isAdmin: member?.role === 'owner' || member?.role === 'admin',
    userId,
    workspaceId,
  };
}

/**
 * Raw-SQL ownership for KnowledgeRepo UNION queries (table alias required).
 * Readable when: admin | public | creator's private | private + grant hit.
 */
export function buildResourceReadableRawSql(
  ctx: ResourceAccessContext,
  alias: string,
  resourceType: ResourceGrantType,
  options?: { isAdminOverride?: boolean },
): SQL {
  const isAdmin = options?.isAdminOverride ?? ctx.isAdmin;
  const a = alias;

  if (isAdmin) {
    return sql`${sql.raw(`${a}.workspace_id`)} = ${ctx.workspaceId}`;
  }

  const deptClause =
    ctx.departmentId === null
      ? sql`(g.grantee_type = 'user' AND g.grantee_id = ${ctx.userId})`
      : sql`(
          (g.grantee_type = 'user' AND g.grantee_id = ${ctx.userId})
          OR (g.grantee_type = 'department' AND g.grantee_id = ${ctx.departmentId})
        )`;

  return sql`${sql.raw(`${a}.workspace_id`)} = ${ctx.workspaceId} AND (
    ${sql.raw(`${a}.visibility`)} IS NULL
    OR ${sql.raw(`${a}.visibility`)} = 'public'
    OR (${sql.raw(`${a}.visibility`)} = 'private' AND ${sql.raw(`${a}.user_id`)} = ${ctx.userId})
    OR (
      ${sql.raw(`${a}.visibility`)} = 'private'
      AND EXISTS (
        SELECT 1 FROM resource_grants g
        WHERE g.workspace_id = ${ctx.workspaceId}
          AND g.resource_type = ${resourceType}
          AND g.resource_id = ${sql.raw(`${a}.id`)}
          AND ${deptClause}
      )
    )
  )`;
}

export function buildResourceListScopeRawSql(
  ctx: ResourceAccessContext,
  alias: string,
  resourceType: ResourceGrantType,
  scope: ResourceListScope | undefined,
): SQL | undefined {
  if (!scope || scope === 'admin_all') return undefined;

  const a = alias;

  if (scope === 'mine') {
    return sql`${sql.raw(`${a}.user_id`)} = ${ctx.userId}`;
  }

  if (scope === 'workspace') {
    return sql`(${sql.raw(`${a}.visibility`)} = 'public' OR ${sql.raw(`${a}.visibility`)} IS NULL)`;
  }

  const deptClause =
    ctx.departmentId === null
      ? sql`(g.grantee_type = 'user' AND g.grantee_id = ${ctx.userId})`
      : sql`(
          (g.grantee_type = 'user' AND g.grantee_id = ${ctx.userId})
          OR (g.grantee_type = 'department' AND g.grantee_id = ${ctx.departmentId})
        )`;

  return sql`${sql.raw(`${a}.visibility`)} = 'private'
    AND ${sql.raw(`${a}.user_id`)} <> ${ctx.userId}
    AND EXISTS (
      SELECT 1 FROM resource_grants g
      WHERE g.workspace_id = ${ctx.workspaceId}
        AND g.resource_type = ${resourceType}
        AND g.resource_id = ${sql.raw(`${a}.id`)}
        AND ${deptClause}
    )`;
}

/** Map legacy visibility filter onto listScope. */
export function resolveListScope(
  listScope?: ResourceListScope,
  visibility?: 'private' | 'public',
): ResourceListScope | undefined {
  if (listScope) return listScope;
  if (visibility === 'private') return 'mine';
  if (visibility === 'public') return 'workspace';
  return undefined;
}
