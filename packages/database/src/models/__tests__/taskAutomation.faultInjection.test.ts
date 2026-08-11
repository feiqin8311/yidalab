// @vitest-environment node
/**
 * Fault-injection coverage for the three critical crash windows:
 * 1. claim after, operation create before
 * 2. operation created after, bind before
 * 3. completion after, "ACK" before (double complete / re-dispatch)
 *
 * Each scenario must converge to at most one agent_operations row per
 * attempt idempotency key, and the ledger must recover without dual-start.
 */
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  taskAutomationRunAttempts,
  taskAutomationRuns,
  tasks,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';
import { buildOperationIdempotencyKey, TaskAutomationModel } from '../taskAutomation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-auto-fault-user';
let model: TaskAutomationModel;
let taskId: string;

beforeEach(async () => {
  model = new TaskAutomationModel(serverDB);
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskAutomationRunAttempts);
  await serverDB.delete(taskAutomationRuns);
  await serverDB.delete(tasks);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);

  const [task] = await serverDB
    .insert(tasks)
    .values({
      automationMode: 'schedule',
      automationRevision: 1,
      createdByUserId: userId,
      identifier: 'T-FAULT-1',
      instruction: 'fault inject',
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
  await serverDB.delete(agentOperations);
  await serverDB.delete(taskAutomationRunAttempts);
  await serverDB.delete(taskAutomationRuns);
  await serverDB.delete(tasks).where(eq(tasks.createdByUserId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

const planAndClaim = async () => {
  const plannedAt = new Date('2026-08-11T09:00:00.000Z');
  const { run } = await model.insertRun({
    automationRevision: 1,
    plannedAt,
    taskId,
    trigger: 'schedule',
    userId,
  });
  const claim = await model.claimNextAttempt({
    claimedBy: 'worker-a',
    leaseSeconds: 120,
    runId: run.id,
  });
  expect(claim).not.toBeNull();
  return claim!;
};

describe('fault injection: crash windows', () => {
  it('window1: claim then crash before operation → release → new attempt, no op created', async () => {
    const claim = await planAndClaim();

    // Simulate process death: lease expires, no operation bound.
    await serverDB.execute(sql`UPDATE task_automation_run_attempts
      SET lease_until = now() - interval '1 minute'
      WHERE id = ${claim.attempt.id}`);

    const released = await model.releaseExpiredAttempt(claim.attempt.id);
    expect(released).not.toBeNull();
    expect(released!.hasOperation).toBe(false);
    expect(released!.run.status).toBe('pending');

    // Second worker claims attempt 2 (new attempt number + new idempotency key).
    const reclaim = await model.claimNextAttempt({ claimedBy: 'worker-b', runId: claim.run.id });
    expect(reclaim).not.toBeNull();
    expect(reclaim!.attempt.attemptNumber).toBe(2);
    expect(reclaim!.attempt.operationIdempotencyKey).toBe(
      buildOperationIdempotencyKey(claim.run.id, 2),
    );
    expect(reclaim!.attempt.operationIdempotencyKey).not.toBe(
      claim.attempt.operationIdempotencyKey,
    );

    // Still zero agent operations — nothing started before the crash.
    const ops = await serverDB.select().from(agentOperations);
    expect(ops).toHaveLength(0);
  });

  it('window2: operation created then crash before bind → recovery rebinds same op', async () => {
    const claim = await planAndClaim();
    const key = claim.attempt.operationIdempotencyKey;
    const opId = `op_fault_${claim.attempt.id}`;

    // Worker created the operation (idempotent insert) but died before bindOperation.
    const opModel = new AgentOperationModel(serverDB, userId);
    const start = await opModel.recordStart({
      idempotencyKey: key,
      operationId: opId,
      taskId,
      trigger: 'schedule',
    });
    expect(start.operationId).toBe(opId);

    // Concurrent retry of same attempt would reuse the same op, not create another.
    const retry = await opModel.recordStart({
      idempotencyKey: key,
      operationId: `op_fault_other_${claim.attempt.id}`,
      taskId,
      trigger: 'schedule',
    });
    expect(retry.operationId).toBe(opId);

    const ops = await serverDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.idempotencyKey, key));
    expect(ops).toHaveLength(1);

    // Expire lease without bind — recovery must rebind, not start a new attempt.
    await serverDB.execute(sql`UPDATE task_automation_run_attempts
      SET lease_until = now() - interval '1 minute'
      WHERE id = ${claim.attempt.id}`);

    // Recovery path: find op by idempotency key and bind.
    const [existingOp] = await serverDB
      .select({ id: agentOperations.id, topicId: agentOperations.topicId })
      .from(agentOperations)
      .where(eq(agentOperations.idempotencyKey, key))
      .limit(1);

    expect(existingOp).toBeDefined();
    await model.bindOperation({
      attemptId: claim.attempt.id,
      claimToken: claim.claimToken,
      operationId: existingOp!.id,
      topicId: existingOp!.topicId,
    });

    const rebound = await model.findAttemptByOperationId(existingOp!.id);
    expect(rebound).not.toBeNull();
    expect(rebound!.id).toBe(claim.attempt.id);
    expect(rebound!.attemptNumber).toBe(1);

    // releaseExpiredAttempt sees operationId and leaves as hasOperation.
    await serverDB.execute(sql`UPDATE task_automation_run_attempts
      SET lease_until = now() - interval '1 minute'
      WHERE id = ${claim.attempt.id}`);
    const released = await model.releaseExpiredAttempt(claim.attempt.id);
    expect(released).not.toBeNull();
    expect(released!.hasOperation).toBe(true);

    // Still exactly one operation for this attempt key.
    const opsAfter = await serverDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.idempotencyKey, key));
    expect(opsAfter).toHaveLength(1);
  });

  it('window3: complete then re-dispatch does not create a second operation for same attempt', async () => {
    const claim = await planAndClaim();
    const key = claim.attempt.operationIdempotencyKey;
    const opId = `op_complete_${claim.attempt.id}`;

    const opModel = new AgentOperationModel(serverDB, userId);
    await opModel.recordStart({
      idempotencyKey: key,
      operationId: opId,
      taskId,
      trigger: 'schedule',
    });
    await model.bindOperation({
      attemptId: claim.attempt.id,
      claimToken: claim.claimToken,
      operationId: opId,
    });

    // Completion fails (terminal) — same ACK-lost surface as success for reclaim.
    const done = await model.completeAttempt({
      attemptId: claim.attempt.id,
      errorCode: 'execution_failed',
      errorMessage: 'simulated',
      status: 'failed',
    });
    expect(done?.run.status).toBe('failed');
    expect(done?.attempt.status).toBe('failed');

    // "ACK lost" / re-dispatch: claimNextAttempt must not work on terminal run.
    const reclaimed = await model.claimNextAttempt({
      claimedBy: 'worker-zombie',
      runId: claim.run.id,
    });
    expect(reclaimed).toBeNull();

    // Manual retry opens a NEW attempt number, not reuse of attempt 1's key.
    const retried = await model.retryRun(claim.run.id);
    expect(retried?.status).toBe('pending');
    const nextClaim = await model.claimNextAttempt({
      claimedBy: 'worker-retry',
      runId: claim.run.id,
    });
    expect(nextClaim).not.toBeNull();
    expect(nextClaim!.attempt.attemptNumber).toBe(2);
    expect(nextClaim!.attempt.operationIdempotencyKey).toBe(
      buildOperationIdempotencyKey(claim.run.id, 2),
    );

    // Original op still unique on key for attempt 1.
    const ops = await serverDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.idempotencyKey, key));
    expect(ops).toHaveLength(1);
    expect(ops[0].id).toBe(opId);
  });

  it('concurrent recordStart with same idempotencyKey yields one operation', async () => {
    const key = 'task-auto:race-run:1';
    const opModel = new AgentOperationModel(serverDB, userId);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        opModel.recordStart({
          idempotencyKey: key,
          operationId: `op_race_${i}`,
          taskId,
          trigger: 'schedule',
        }),
      ),
    );

    const ids = new Set(results.map((r) => r.operationId));
    expect(ids.size).toBe(1);

    const rows = await serverDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it('concurrent claimNextAttempt yields exactly one winner', async () => {
    const plannedAt = new Date('2026-08-11T10:00:00.000Z');
    const { run } = await model.insertRun({
      automationRevision: 1,
      plannedAt,
      taskId,
      trigger: 'schedule',
      userId,
    });

    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        model.claimNextAttempt({ claimedBy: `w${i}`, runId: run.id }),
      ),
    );

    const winners = claims.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.attempt.attemptNumber).toBe(1);

    const attempts = await serverDB
      .select()
      .from(taskAutomationRunAttempts)
      .where(eq(taskAutomationRunAttempts.runId, run.id));
    expect(attempts).toHaveLength(1);
  });
});
