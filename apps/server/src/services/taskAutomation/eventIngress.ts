import type { TaskEventFilter, TaskItem, TaskProductEventType } from '@lobechat/types';
import debug from 'debug';
import { and, eq, sql } from 'drizzle-orm';

import { TaskAutomationModel } from '@/database/models/taskAutomation';
import { tasks } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  isProductEventType,
  mapSignalToProductEvent,
  PRODUCT_EVENT_FILTER_FIELDS,
} from './eventCatalog';
import { isWorkspaceInV2Scope, shouldV2AcceptNewEvents } from './mode';

const log = debug('task-automation:event-ingress');

export interface AutomationEventPayload {
  /** Flat metadata for filter matching — never store message body. */
  meta?: Record<string, unknown>;
  /** Originating agent operation id — used to block self-trigger recursion. */
  operationId?: string;
  /** Stable source event id (required for dedupe). Generated if missing. */
  sourceEventId: string;
  /** Internal Agent Signal sourceType OR product event key. */
  sourceType: string;
  userId?: string;
  /** Workspace isolation — required when matching workspace tasks. */
  workspaceId?: string | null;
}

/**
 * Ingress for product-level events → plan automation runs.
 * latest-event cooldown: same task/source/scope time bucket → one plan.
 * Only when mode=on (not drain/shadow) and workspace is in canary scope.
 */
export async function ingestAutomationEvent(
  db: LobeChatDatabase,
  payload: AutomationEventPayload,
): Promise<{ planned: number }> {
  if (!shouldV2AcceptNewEvents()) return { planned: 0 };
  if (!isWorkspaceInV2Scope(payload.workspaceId)) return { planned: 0 };

  const product =
    (isProductEventType(payload.sourceType) ? payload.sourceType : null) ??
    mapSignalToProductEvent(payload.sourceType);

  if (!product) {
    log('ignore unknown sourceType=%s', payload.sourceType);
    return { planned: 0 };
  }

  // Find armed event-mode tasks for this product event.
  const candidates = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.automationMode, 'event'),
        eq(tasks.eventSourceType, product),
        sql`${tasks.status} NOT IN ('canceled', 'completed', 'failed', 'paused', 'running')`,
        payload.workspaceId
          ? eq(tasks.workspaceId, payload.workspaceId)
          : payload.userId
            ? and(eq(tasks.createdByUserId, payload.userId), sql`${tasks.workspaceId} IS NULL`)
            : sql`true`,
      ),
    );

  if (candidates.length === 0) return { planned: 0 };

  const model = new TaskAutomationModel(db);
  let planned = 0;
  const now = new Date();

  for (const task of candidates) {
    // Block recursion: task must not consume events from its own operation.
    if (payload.operationId && payload.meta?.taskId === task.id) {
      log('skip self-trigger task=%s op=%s', task.id, payload.operationId);
      continue;
    }
    if (payload.meta?.taskId === task.id) {
      log('skip event produced by same task=%s', task.id);
      continue;
    }

    if (!matchesFilters(task, product, payload.meta ?? {})) continue;

    const cooldown = task.eventCooldownSeconds ?? 60;
    const bucketMs = Math.max(cooldown, 1) * 1000;
    const bucket = Math.floor(now.getTime() / bucketMs);
    // latest-event: scope time bucket + source id for uniqueness
    const dedupePlannedAt = new Date(bucket * bucketMs);
    // Use event dedupe key shape via sourceEventId in plannedAt? Better:
    // insert with event-specific dedupe: taskId:event:sourceEventId OR cooldown bucket.
    const sourceEventId = payload.sourceEventId || `${product}:${bucket}`;

    const { created } = await model.insertEventRun({
      automationRevision: task.automationRevision ?? 0,
      plannedAt: dedupePlannedAt,
      sourceEventId,
      taskId: task.id,
      userId: task.createdByUserId,
      workspaceId: task.workspaceId,
    });

    if (created) {
      planned += 1;
      log('planned event run task=%s product=%s source=%s', task.id, product, sourceEventId);
    }
  }

  return { planned };
}

function matchesFilters(
  task: TaskItem,
  product: TaskProductEventType,
  meta: Record<string, unknown>,
): boolean {
  const filters = (task.eventFilter ?? []) as TaskEventFilter[];
  if (filters.length === 0) return true;
  if (filters.length > 5) return false;

  const allowed = new Set(PRODUCT_EVENT_FILTER_FIELDS[product] ?? []);
  for (const f of filters) {
    if (!allowed.has(f.field)) return false;
    const actual = meta[f.field];
    if (f.op === 'eq') {
      if (String(actual ?? '') !== String(f.value)) return false;
    } else if (f.op === 'in') {
      const list = Array.isArray(f.value) ? f.value.map(String) : [String(f.value)];
      if (!list.includes(String(actual ?? ''))) return false;
    } else {
      return false;
    }
  }
  return true;
}
