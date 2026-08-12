// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { taskAutomationRunAttempts, taskAutomationRuns, tasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  buildAutomationDedupeKey,
  buildOperationIdempotencyKey,
  TaskAutomationModel,
} from '../taskAutomation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-automation-model-test-user';
let model: TaskAutomationModel;
let taskId: string;

beforeEach(async () => {
  model = new TaskAutomationModel(serverDB);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);

  const [task] = await serverDB
    .insert(tasks)
    .values({
      automationMode: 'schedule',
      automationRevision: 1,
      createdByUserId: userId,
      identifier: 'T-AUTO-1',
      instruction: 'test',
      scheduleKind: 'cron',
      schedulePattern: '0 9 * * *',
      scheduleTimezone: 'UTC',
      seq: 1,
      status: 'scheduled',
    })
    .returning();
  taskId = task.id;
});

afterEach(async () => {
  await serverDB.delete(taskAutomationRunAttempts);
  await serverDB.delete(taskAutomationRuns);
  await serverDB.delete(tasks).where(eq(tasks.createdByUserId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('TaskAutomationModel', () => {
  it('insertRun is idempotent on dedupeKey', async () => {
    const plannedAt = new Date('2026-08-11T09:00:00.000Z');
    const a = await model.insertRun({
      automationRevision: 1,
      plannedAt,
      taskId,
      trigger: 'schedule',
      userId,
    });
    const b = await model.insertRun({
      automationRevision: 1,
      plannedAt,
      taskId,
      trigger: 'schedule',
      userId,
    });

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.run.id).toBe(b.run.id);
    expect(a.run.dedupeKey).toBe(buildAutomationDedupeKey(taskId, 'schedule', plannedAt));
  });

  it('claimNextAttempt is exclusive under concurrent claims', async () => {
    const plannedAt = new Date('2026-08-11T09:00:00.000Z');
    const { run } = await model.insertRun({
      automationRevision: 1,
      plannedAt,
      taskId,
      trigger: 'schedule',
      userId,
    });

    const [c1, c2, c3] = await Promise.all([
      model.claimNextAttempt({ claimedBy: 'w1', runId: run.id }),
      model.claimNextAttempt({ claimedBy: 'w2', runId: run.id }),
      model.claimNextAttempt({ claimedBy: 'w3', runId: run.id }),
    ]);

    const winners = [c1, c2, c3].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.attempt.attemptNumber).toBe(1);
    expect(winners[0]!.attempt.operationIdempotencyKey).toBe(
      buildOperationIdempotencyKey(run.id, 1),
    );
    expect(winners[0]!.run.status).toBe('running');
  });

  it('releaseExpiredAttempt re-pends when no operation bound', async () => {
    const plannedAt = new Date('2026-08-11T09:00:00.000Z');
    const { run } = await model.insertRun({
      automationRevision: 1,
      plannedAt,
      taskId,
      trigger: 'schedule',
      userId,
    });

    const claim = await model.claimNextAttempt({
      claimedBy: 'w1',
      leaseSeconds: 1,
      runId: run.id,
    });
    expect(claim).not.toBeNull();

    await serverDB.execute(sql`UPDATE task_automation_run_attempts
       SET lease_until = now() - interval '1 minute'
       WHERE id = ${claim!.attempt.id}`);

    const released = await model.releaseExpiredAttempt(claim!.attempt.id);
    expect(released).not.toBeNull();
    expect(released!.hasOperation).toBe(false);
    expect(released!.run.status).toBe('pending');

    const reclaim = await model.claimNextAttempt({ claimedBy: 'w2', runId: run.id });
    expect(reclaim).not.toBeNull();
    expect(reclaim!.attempt.attemptNumber).toBe(2);
    expect(reclaim!.attempt.operationIdempotencyKey).toBe(buildOperationIdempotencyKey(run.id, 2));
  });

  it('reclaim expired running attempt keeps same attemptNumber / idempotency key', async () => {
    const plannedAt = new Date('2026-08-11T10:00:00.000Z');
    const { run } = await model.insertRun({
      automationRevision: 1,
      plannedAt,
      taskId,
      trigger: 'schedule',
      userId,
    });

    const claim = await model.claimNextAttempt({
      claimedBy: 'w1',
      leaseSeconds: 1,
      runId: run.id,
    });

    await serverDB.execute(sql`UPDATE task_automation_run_attempts
       SET lease_until = now() - interval '1 minute'
       WHERE id = ${claim!.attempt.id}`);

    // Put run back to pending while attempt is still running+expired so
    // claimNextAttempt takes the in-place reclaim path.
    await serverDB.execute(sql`UPDATE task_automation_runs
       SET status = 'pending' WHERE id = ${run.id}`);

    const reclaim = await model.claimNextAttempt({ claimedBy: 'w2', runId: run.id });
    expect(reclaim).not.toBeNull();
    expect(reclaim!.attempt.attemptNumber).toBe(1);
    expect(reclaim!.attempt.id).toBe(claim!.attempt.id);
    expect(reclaim!.attempt.operationIdempotencyKey).toBe(claim!.attempt.operationIdempotencyKey);
    expect(reclaim!.created).toBe(false);
  });
});
