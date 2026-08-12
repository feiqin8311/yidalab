import type { DeliveryAttemptStatus, DeliveryType } from '@lobechat/types';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { agentOperations } from './agentOperations';
import { workspaces } from './workspace';

/**
 * Durable delivery outbox — separates "agent finished" from "artifact delivered".
 *
 * Unique (operation_id, delivery_type, target_folder, artifact_hash) prevents
 * duplicate uploads and supports retry / admin re-delivery / reconnect recovery.
 */
export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('deliveryAttempts'))
      .notNull(),

    operationId: text('operation_id')
      .references(() => agentOperations.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id').notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** dingpan-report | dingpan-file | bot-webhook */
    deliveryType: text('delivery_type').$type<DeliveryType>().notNull(),

    /**
     * Stable folder scope (e.g. spaceId:folderId or "default").
     * Part of the uniqueness key with artifactHash.
     */
    targetFolder: text('target_folder').notNull().default('default'),

    /**
     * Content identity for idempotency (hash of HTML / file bytes, or fixed
     * token like "report" when content is not yet known at enqueue time).
     */
    artifactHash: text('artifact_hash').notNull().default('report'),

    /**
     * Human-readable dedupe key (mirrors unique tuple).
     * Format: `${operationId}:${deliveryType}:${targetFolder}:${artifactHash}`
     */
    dedupeKey: text('dedupe_key').notNull(),

    status: text('status').$type<DeliveryAttemptStatus>().notNull().default('pending'),
    attempt: integer('attempt').notNull().default(0),

    claimToken: text('claim_token'),
    claimedBy: text('claimed_by'),
    leaseUntil: timestamptz('lease_until'),
    nextAttemptAt: timestamptz('next_attempt_at'),

    fileId: text('file_id'),
    spaceId: text('space_id'),
    previewUrl: text('preview_url'),
    artifactId: text('artifact_id'),

    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    retryable: boolean('retryable').notNull().default(true),

    /**
     * unverified | verified | failed — post-upload read-back result.
     * Model "success" alone never sets verified.
     */
    verificationStatus: text('verification_status').notNull().default('unverified'),
    verifiedAt: timestamptz('verified_at'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('delivery_attempts_dedupe_uidx').on(
      t.operationId,
      t.deliveryType,
      t.targetFolder,
      t.artifactHash,
    ),
    uniqueIndex('delivery_attempts_dedupe_key_uidx').on(t.dedupeKey),
    index('delivery_attempts_operation_id_idx').on(t.operationId),
    index('delivery_attempts_status_next_idx').on(t.status, t.nextAttemptAt),
    index('delivery_attempts_user_id_idx').on(t.userId),
    index('delivery_attempts_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewDeliveryAttempt = typeof deliveryAttempts.$inferInsert;
export type DeliveryAttemptItem = typeof deliveryAttempts.$inferSelect;
