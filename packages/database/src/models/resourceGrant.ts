import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  type NewResourceGrant,
  type ResourceGranteeType,
  type ResourceGrantRole,
  resourceGrants,
  type ResourceGrantType,
} from '../schemas/resourceGrant';
import { departments, workspaceMembers } from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';

export interface ResourceGrantInput {
  granteeId: string;
  granteeType: ResourceGranteeType;
  role?: ResourceGrantRole;
}

export class ResourceGrantModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  list = async (resourceType: ResourceGrantType, resourceId: string) => {
    if (!this.workspaceId) return [];

    return this.db
      .select()
      .from(resourceGrants)
      .where(
        and(
          eq(resourceGrants.workspaceId, this.workspaceId),
          eq(resourceGrants.resourceType, resourceType),
          eq(resourceGrants.resourceId, resourceId),
        ),
      );
  };

  /**
   * Full-replace grants for a resource. Enforces:
   * - workspace mode only
   * - grantees belong to workspace
   * - departments belong to workspace
   *
   * Caller must already verify the user is the resource creator.
   * Empty `grants` clears all grants (pure private).
   */
  set = async (
    resourceType: ResourceGrantType,
    resourceId: string,
    grants: ResourceGrantInput[],
  ) => {
    if (!this.workspaceId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Resource grants only apply inside a workspace',
      });
    }

    const workspaceId = this.workspaceId;

    const unique = new Map<string, ResourceGrantInput>();
    for (const g of grants) {
      unique.set(`${g.granteeType}:${g.granteeId}`, g);
    }
    const next = [...unique.values()];

    if (next.length > 0) {
      const userIds = next.filter((g) => g.granteeType === 'user').map((g) => g.granteeId);
      const departmentIds = next
        .filter((g) => g.granteeType === 'department')
        .map((g) => g.granteeId);

      if (userIds.length > 0) {
        const activeMembers = await this.db
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              inArray(workspaceMembers.userId, userIds),
              isNull(workspaceMembers.deletedAt),
            ),
          );
        const activeSet = new Set(activeMembers.map((m) => m.userId));
        for (const id of userIds) {
          if (!activeSet.has(id)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `User ${id} is not a member of this workspace`,
            });
          }
        }
      }

      if (departmentIds.length > 0) {
        const deps = await this.db
          .select({ id: departments.id })
          .from(departments)
          .where(
            and(eq(departments.workspaceId, workspaceId), inArray(departments.id, departmentIds)),
          );
        const depSet = new Set(deps.map((d) => d.id));
        for (const id of departmentIds) {
          if (!depSet.has(id)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Department ${id} is not in this workspace`,
            });
          }
        }
      }
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(resourceGrants)
        .where(
          and(
            eq(resourceGrants.workspaceId, workspaceId),
            eq(resourceGrants.resourceType, resourceType),
            eq(resourceGrants.resourceId, resourceId),
          ),
        );

      if (next.length === 0) return;

      const rows: NewResourceGrant[] = next.map((g) => ({
        grantedBy: this.userId,
        granteeId: g.granteeId,
        granteeType: g.granteeType,
        resourceId,
        resourceType,
        role: g.role ?? 'viewer',
        workspaceId,
      }));

      await tx.insert(resourceGrants).values(rows);
    });

    return this.list(resourceType, resourceId);
  };

  /** Drop all grants for a resource (used when flipping to public). */
  clear = async (resourceType: ResourceGrantType, resourceId: string) => {
    if (!this.workspaceId) return;
    await this.db
      .delete(resourceGrants)
      .where(
        and(
          eq(resourceGrants.workspaceId, this.workspaceId),
          eq(resourceGrants.resourceType, resourceType),
          eq(resourceGrants.resourceId, resourceId),
        ),
      );
  };
}
