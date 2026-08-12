import type { TaskItem } from '@lobechat/types';
import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import debug from 'debug';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskAutomationModel } from '@/database/models/taskAutomation';
import { taskAutomationRuns } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { TaskResultBridgeService } from '@/server/services/taskResultBridge';

import { computeNextHeartbeatRunAt, computeNextScheduleRunAt } from './nextRun';

const log = debug('task-automation:completion');

/**
 * Called from TaskLifecycleService after a topic completes when the run was
 * started by an automation attempt (matched via operationId).
 *
 * Always accepts completion when an attempt exists — even if mode is off/drain —
 * so in-flight operations can close the ledger during rollback.
 */
export async function onAutomationOperationComplete(params: {
  db: LobeChatDatabase;
  errorMessage?: string;
  operationId: string;
  reason: string;
  task: TaskItem;
}): Promise<boolean> {
  const model = new TaskAutomationModel(params.db);
  const attempt = await model.findAttemptByOperationId(params.operationId);
  if (!attempt) return false;

  const succeeded = params.reason === 'done';
  const completed = await model.completeAttempt({
    attemptId: attempt.id,
    errorCode: succeeded ? null : 'execution_failed',
    errorMessage: succeeded ? null : (params.errorMessage ?? params.reason),
    status: succeeded ? 'succeeded' : 'failed',
  });

  const task = params.task;
  const run = completed?.run;

  if (succeeded) {
    // at-mode: complete the task after one successful fire
    if (
      task.automationMode === 'schedule' &&
      (task.scheduleKind === 'at' || (!task.scheduleKind && task.scheduleAt))
    ) {
      const taskModel = new TaskModel(
        params.db,
        task.createdByUserId,
        task.workspaceId ?? undefined,
      );
      await taskModel.updateStatus(task.id, 'completed', { completedAt: new Date() });
      await model.setTaskNextRunAt(task.id, null);
    } else if (task.automationMode === 'heartbeat') {
      // Prefer effective next-check written during the run (pacing); else interval.
      const nextCheck = run?.effectiveNextCheckAt
        ? new Date(run.effectiveNextCheckAt)
        : computeNextHeartbeatRunAt(task, new Date());
      if (nextCheck) await model.setTaskNextRunAt(task.id, nextCheck);
    } else if (task.automationMode === 'schedule' && !task.nextRunAt) {
      const next = computeNextScheduleRunAt(task, new Date());
      if (next) await model.setTaskNextRunAt(task.id, next);
    }
  } else if (task.automationMode === 'heartbeat') {
    const base =
      task.heartbeatInterval && task.heartbeatInterval > 0 ? task.heartbeatInterval : 600;
    const backoffSec = Math.min(base, 300);
    await model.setTaskNextRunAt(task.id, new Date(Date.now() + backoffSec * 1000));
  }

  // Failure alert once per logical run (not per attempt).
  if (!succeeded && run) {
    await alertAutomationFailureOnce({
      db: params.db,
      errorMessage: params.errorMessage ?? params.reason,
      operationId: params.operationId,
      runId: run.id,
      task,
    });
  }

  log(
    'complete op=%s attempt=%s status=%s task=%s',
    params.operationId,
    attempt.id,
    succeeded ? 'succeeded' : 'failed',
    task.id,
  );
  return true;
}

/**
 * Mark alerted_at if null (atomic) then deliver urgent brief + result bridge.
 * Notification failure must not change run terminal status.
 */
async function alertAutomationFailureOnce(params: {
  db: LobeChatDatabase;
  errorMessage: string;
  operationId: string;
  runId: string;
  task: TaskItem;
}): Promise<void> {
  try {
    const now = new Date();
    const updated = await params.db
      .update(taskAutomationRuns)
      .set({ alertedAt: now, updatedAt: now })
      .where(and(eq(taskAutomationRuns.id, params.runId), isNull(taskAutomationRuns.alertedAt)))
      .returning({ id: taskAutomationRuns.id });

    if (updated.length === 0) return; // already alerted

    const { task } = params;
    const wsId = task.workspaceId ?? undefined;
    const briefModel = new BriefModel(params.db, task.createdByUserId, wsId);
    await briefModel.create({
      actions: DEFAULT_BRIEF_ACTIONS['error'],
      agentId: task.assigneeAgentId || undefined,
      priority: 'urgent',
      summary: `Automation run failed: ${params.errorMessage}`,
      taskId: task.id,
      title: `${task.identifier} automation failed`,
      trigger: 'task',
      type: 'error',
    });

    // Best-effort creator session bridge — same contract as lifecycle.
    try {
      await new TaskResultBridgeService(params.db, task.createdByUserId, wsId).deliver({
        errorMessage: params.errorMessage,
        operationId: params.operationId,
        reason: 'error',
        taskId: task.id,
        taskIdentifier: task.identifier,
      });
    } catch (e) {
      log('result bridge on automation failure failed (non-fatal): %O', e);
    }
  } catch (error) {
    log('alertAutomationFailureOnce failed (non-fatal): %O', error);
  }
}

/** Daily cleanup of terminal ledger rows older than retentionDays (default 180). */
export async function cleanupOldAutomationRuns(
  db: LobeChatDatabase,
  options: { batchSize?: number; retentionDays?: number } = {},
): Promise<number> {
  const retentionDays = options.retentionDays ?? 180;
  const batchSize = options.batchSize ?? 1000;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

  // Never delete non-terminal rows.
  const result = await db.execute(sql`
    DELETE FROM task_automation_runs
    WHERE id IN (
      SELECT id FROM task_automation_runs
      WHERE status IN ('succeeded', 'failed', 'skipped', 'canceled')
        AND finished_at IS NOT NULL
        AND finished_at < ${cutoff}
      LIMIT ${batchSize}
    )
  `);

  // drizzle/pg execute rowCount varies by driver
  const count = Number((result as { rowCount?: number }).rowCount ?? 0);
  log('cleanup: deleted %d runs older than %d days', count, retentionDays);
  return count;
}
