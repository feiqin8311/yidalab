import { hostname } from 'node:os';

import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskAutomationModel } from '@/database/models/taskAutomation';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { tasks } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { TaskRunnerService } from '@/server/services/taskRunner';

import { recordAutomationMetric } from './metrics';

const log = debug('task-automation:worker');

const WORKER_ID = `${hostname()}:${process.pid}`;

export type ProcessRunOutcome =
  { ran: true; operationId: string; runId: string } | { ran: false; reason: string; runId: string };

/**
 * Worker: claim attempt → revalidate task → run agent with operation
 * idempotency key → bind operationId.
 *
 * Safe under multi-instance: claim is a single-row conditional update;
 * agent op is unique on idempotency_key.
 */
export async function processAutomationRun(
  db: LobeChatDatabase,
  runId: string,
): Promise<ProcessRunOutcome> {
  const model = new TaskAutomationModel(db);
  const claimStarted = Date.now();
  const claim = await model.claimNextAttempt({ claimedBy: WORKER_ID, runId });

  if (!claim) {
    log('skip run=%s reason=not-claimable', runId);
    return { ran: false, reason: 'not-claimable', runId };
  }

  const { attempt, claimToken, run } = claim;
  const dispatchLatencyMs = Math.max(0, claimStarted - new Date(run.plannedAt).getTime());
  recordAutomationMetric('dispatch_latency_ms', dispatchLatencyMs, {
    runId,
    taskId: run.taskId,
    trigger: run.trigger,
  });

  // Load task without user ownership filter (system dispatch).
  const [task] = await db.select().from(tasks).where(eq(tasks.id, run.taskId)).limit(1);

  if (!task) {
    await model.completeAttempt({
      attemptId: attempt.id,
      errorCode: 'task_not_found',
      errorMessage: 'Task not found',
      status: 'skipped',
    });
    return { ran: false, reason: 'task-not-found', runId };
  }

  const userId = task.createdByUserId;
  const wsId = task.workspaceId ?? undefined;

  // Config revision: old planned runs must not start after config change.
  if ((task.automationRevision ?? 0) !== run.automationRevision) {
    log('skip run=%s reason=revision-mismatch', runId);
    await model.completeAttempt({
      attemptId: attempt.id,
      errorCode: 'revision_mismatch',
      errorMessage: `Task revision ${task.automationRevision} != run ${run.automationRevision}`,
      status: 'skipped',
    });
    return { ran: false, reason: 'revision-mismatch', runId };
  }

  if (!task.automationMode) {
    await model.completeAttempt({
      attemptId: attempt.id,
      errorCode: 'mode_changed',
      errorMessage: `automationMode=${task.automationMode}`,
      status: 'skipped',
    });
    return { ran: false, reason: 'mode-changed', runId };
  }

  if (['canceled', 'completed', 'failed'].includes(task.status)) {
    await model.completeAttempt({
      attemptId: attempt.id,
      errorCode: 'terminal',
      errorMessage: `task status=${task.status}`,
      status: 'skipped',
    });
    return { ran: false, reason: 'terminal', runId };
  }

  if (task.status === 'paused') {
    await model.completeAttempt({
      attemptId: attempt.id,
      errorCode: 'paused',
      errorMessage: 'task paused',
      status: 'skipped',
    });
    return { ran: false, reason: 'paused', runId };
  }

  const briefModel = new BriefModel(db, userId, wsId);
  if (await briefModel.hasUnresolvedUrgentByTask(task.id, { excludeTypes: ['error'] })) {
    // Human waiting — leave run pending for later (do not burn attempt permanently).
    await model.failAttemptForRetry({
      attemptId: attempt.id,
      errorCode: 'human_waiting',
      errorMessage: 'Unresolved urgent brief',
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    return { ran: false, reason: 'human-waiting', runId };
  }

  // maxExecutions (schedule only) — same semantics as legacy scheduleTick.
  if (task.automationMode === 'schedule') {
    const scheduleConfig =
      ((task.config as { schedule?: { maxExecutions?: number | null } } | null) ?? {}).schedule ??
      {};
    const maxExecutions = scheduleConfig.maxExecutions ?? null;
    if (maxExecutions != null && maxExecutions > 0) {
      const scheduler =
        ((task.context as { scheduler?: { scheduleStartedAt?: string } } | null) ?? {}).scheduler ??
        {};
      if (scheduler.scheduleStartedAt) {
        const topicModel = new TaskTopicModel(db, userId, wsId);
        const runCount = await topicModel.countByTask(task.id, {
          since: new Date(scheduler.scheduleStartedAt),
          triggers: ['schedule'],
        });
        if (runCount >= maxExecutions) {
          const taskModel = new TaskModel(db, userId, wsId);
          await taskModel.updateStatus(task.id, 'completed', { completedAt: new Date() });
          await model.completeAttempt({
            attemptId: attempt.id,
            errorCode: 'max_executions',
            errorMessage: `${runCount}/${maxExecutions}`,
            status: 'skipped',
          });
          return { ran: false, reason: 'max-executions', runId };
        }
      }
    }
  }

  const trigger =
    run.trigger === 'heartbeat'
      ? 'heartbeat'
      : run.trigger === 'event'
        ? 'schedule' // topic trigger enum is schedule|heartbeat|manual; map event→schedule for quota
        : 'schedule';
  const idempotencyKey = attempt.operationIdempotencyKey;

  const runner = new TaskRunnerService(db, userId, wsId);
  try {
    const result = await runner.runTask({
      operationIdempotencyKey: idempotencyKey,
      taskId: task.id,
      trigger,
    });

    await model.bindOperation({
      attemptId: attempt.id,
      claimToken,
      operationId: result.operationId,
      topicId: result.topicId,
    });
    recordAutomationMetric('operation_bind', 1, {
      attempt: attempt.attemptNumber,
      operationId: result.operationId,
      runId,
    });

    // Extend lease while agent is running asynchronously.
    await model.extendLease({ attemptId: attempt.id, claimToken, leaseSeconds: 600 });

    log(
      'ran run=%s attempt=%d op=%s task=%s',
      runId,
      attempt.attemptNumber,
      result.operationId,
      task.identifier,
    );
    return { ran: true, operationId: result.operationId, runId };
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'CONFLICT') {
      // Another topic already running — retry later.
      await model.failAttemptForRetry({
        attemptId: attempt.id,
        errorCode: 'in_flight',
        errorMessage: error.message,
        nextAttemptAt: new Date(Date.now() + 30_000),
      });
      return { ran: false, reason: 'in-flight', runId };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    await model.failAttemptForRetry({
      attemptId: attempt.id,
      errorCode: 'start_failed',
      errorMessage: message,
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    throw error;
  }
}
