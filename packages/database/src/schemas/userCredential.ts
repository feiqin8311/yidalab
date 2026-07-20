import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Local (self-hosted) credentials — personal or workspace-scoped.
 * Replaces Market-backed creds for second-party deployments.
 *
 * `valuesEncrypted` is AES-GCM ciphertext via KeyVaultsGateKeeper (JSON of key→value).
 * Market-compatible list shape uses numeric `id` (serial/identity).
 */
export const userCredentials = pgTable(
  'user_credentials',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null = personal credential owned by userId. Non-null = workspace-shared (future). */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Unique slug within owner scope, e.g. dingtalk-dingpan */
    key: varchar('key', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    /** 'kv-env' | 'kv-header' | 'oauth' | 'file' — local path only implements kv-* for now */
    type: text('type').notNull(),
    /** AES-GCM encrypted JSON for KV types; null for non-kv stubs */
    valuesEncrypted: text('values_encrypted'),
    maskedPreview: varchar('masked_preview', { length: 64 }),
    lastUsedAt: timestamptz('last_used_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_credentials_personal_key_uidx')
      .on(t.userId, t.key)
      .where(sql`${t.workspaceId} is null`),
    uniqueIndex('user_credentials_workspace_key_uidx')
      .on(t.workspaceId, t.key)
      .where(sql`${t.workspaceId} is not null`),
    index('user_credentials_user_id_idx').on(t.userId),
    index('user_credentials_workspace_id_idx').on(t.workspaceId),
  ],
);

export type UserCredentialItem = typeof userCredentials.$inferSelect;
export type NewUserCredential = typeof userCredentials.$inferInsert;
