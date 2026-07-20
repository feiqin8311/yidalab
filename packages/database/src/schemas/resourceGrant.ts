import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/** Resource kinds that support fine-grained grants. */
export const RESOURCE_GRANT_TYPES = ['file', 'knowledge_base', 'document'] as const;
export type ResourceGrantType = (typeof RESOURCE_GRANT_TYPES)[number];

/** Who the grant targets. */
export const RESOURCE_GRANTEE_TYPES = ['user', 'department'] as const;
export type ResourceGranteeType = (typeof RESOURCE_GRANTEE_TYPES)[number];

/** Access role on a grant. First ship is viewer-only. */
export const RESOURCE_GRANT_ROLES = ['viewer', 'editor'] as const;
export type ResourceGrantRole = (typeof RESOURCE_GRANT_ROLES)[number];

/**
 * Fine-grained share targets for workspace resources.
 *
 * Complements `visibility` on the resource row:
 * - `public` → whole workspace (grants must be empty)
 * - `private` + no grants → creator only
 * - `private` + grants → creator + listed users/departments
 *
 * Workspace owner/admin can always *read* (enforced in query layer), but only
 * the creator can mutate grants.
 */
export const resourceGrants = pgTable(
  'resource_grants',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('resourceGrants'))
      .primaryKey(),

    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),

    resourceType: text('resource_type').$type<ResourceGrantType>().notNull(),
    resourceId: text('resource_id').notNull(),

    granteeType: text('grantee_type').$type<ResourceGranteeType>().notNull(),
    granteeId: text('grantee_id').notNull(),

    role: text('role').$type<ResourceGrantRole>().notNull().default('viewer'),

    grantedBy: text('granted_by')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('resource_grants_unique').on(
      t.workspaceId,
      t.resourceType,
      t.resourceId,
      t.granteeType,
      t.granteeId,
    ),
    index('resource_grants_resource_idx').on(t.resourceType, t.resourceId),
    index('resource_grants_grantee_idx').on(t.workspaceId, t.granteeType, t.granteeId),
    index('resource_grants_workspace_idx').on(t.workspaceId),
  ],
);

export type NewResourceGrant = typeof resourceGrants.$inferInsert;
export type ResourceGrantItem = typeof resourceGrants.$inferSelect;
