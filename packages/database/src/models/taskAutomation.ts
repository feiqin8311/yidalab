import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type {
  NewTaskAutomationRun,
  NewTaskAutomationRunAttempt,
  TaskAutomationAttemptStatus,
  TaskAutomationRunAttemptItem,
  TaskAutomationRunItem,
  TaskAutomationRunStatus,
  TaskAutomationTrigger,
} from '../schemas/task';
import { taskAutomationRunAttempts, taskAutomationRuns, tasks } from '../schemas/task';
import type { LobeChatDatabase } from '../type';
import { createNanoId } from '../utils/idGenerator';

const nano = createNanoId(16);

export const buildAutomationDedupeKey = (
  taskId: string,
  trigger: TaskAutomationTrigger,
  plannedAt: Date,
): string => `${taskId}:${trigger}:${plannedAt.toISOString()}`;

/** Event dedupe: stable source event id (or cooldown bucket). */
export const buildEventDedupeKey = (taskId: string, sourceEventId: string): string =>
  `${taskId}:event:${sourceEventId}`;

export const buildOperationIdempotencyKey = (runId: string, attemptNumber: number): string =>
  `task-auto:${runId}:${attemptNumber}`;

export interface InsertAutomationRunParams {
  automationRevision: number;
  missedCount?: number;
  plannedAt: Date;
  taskId: string;
  trigger: TaskAutomationTrigger;
  userId: string;
  workspaceId?: string | null;
}

export interface ClaimAttemptResult {
  attempt: TaskAutomationRunAttemptItem;
  claimToken: string;
  created: boolean;
  run: TaskAutomationRunItem;
}

/**
 * System-level automation ledger model (no per-user ownership filter).
 * Planner / dispatcher / worker / recovery all use this path.
 */
export class TaskAutomationModel {
  constructor(private readonly db: LobeChatDatabase) {}

  /**
   * Insert a logical run. ON CONFLICT (dedupe_key) DO NOTHING.
   * Returns the existing or newly inserted row.
   */
  async insertRun(params: InsertAutomationRunParams): Promise<{
    created: boolean;
    run: TaskAutomationRunItem;
  }> {
    const dedupeKey = buildAutomationDedupeKey(params.taskId, params.trigger, params.plannedAt);
    const values: NewTaskAutomationRun = {
      automationRevision: params.automationRevision,
      dedupeKey,
      missedCount: params.missedCount ?? 0,
      plannedAt: params.plannedAt,
      status: 'pending',
      taskId: params.taskId,
      trigger: params.trigger,
      userId: params.userId,
      workspaceId: params.workspaceId ?? null,
    };

    const inserted = await this.db
      .insert(taskAutomationRuns)
      .values(values)
      .onConflictDoNothing({ target: taskAutomationRuns.dedupeKey })
      .returning();

    if (inserted[0]) return { created: true, run: inserted[0] };

    const [existing] = await this.db
      .select()
      .from(taskAutomationRuns)
      .where(eq(taskAutomationRuns.dedupeKey, dedupeKey))
      .limit(1);

    if (!existing) {
      throw new Error(`task automation run missing after conflict: ${dedupeKey}`);
    }
    return { created: false, run: existing };
  }

  async findRunById(runId: string): Promise<TaskAutomationRunItem | null> {
    const [row] = await this.db
      .select()
      .from(taskAutomationRuns)
      .where(eq(taskAutomationRuns.id, runId))
      .limit(1);
    return row ?? null;
  }

  async findRunByOperationId(operationId: string): Promise<TaskAutomationRunItem | null> {
    const [row] = await this.db
      .select()
      .from(taskAutomationRuns)
      .where(eq(taskAutomationRuns.operationId, operationId))
      .limit(1);
    return row ?? null;
  }

  async findAttemptByOperationId(
    operationId: string,
  ): Promise<TaskAutomationRunAttemptItem | null> {
    const [row] = await this.db
      .select()
      .from(taskAutomationRunAttempts)
      .where(eq(taskAutomationRunAttempts.operationId, operationId))
      .limit(1);
    return row ?? null;
  }

  async findAttemptByIdempotencyKey(key: string): Promise<TaskAutomationRunAttemptItem | null> {
    const [row] = await this.db
      .select()
      .from(taskAutomationRunAttempts)
      .where(eq(taskAutomationRunAttempts.operationIdempotencyKey, key))
      .limit(1);
    return row ?? null;
  }

  /**
   * Atomically create (if needed) and claim the next attempt for a pending run.
   *
   * - If the run is not pending → null
   * - If a non-expired running attempt exists → null (already claimed)
   * - Else insert attempt N+1 (or reuse pending attempt) and claim it
   */
  async claimNextAttempt(params: {
    claimedBy: string;
    leaseSeconds?: number;
    runId: string;
  }): Promise<ClaimAttemptResult | null> {
    const leaseSeconds = params.leaseSeconds ?? 120;
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const claimToken = nano();

    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(taskAutomationRuns)
        .where(eq(taskAutomationRuns.id, params.runId))
        .for('update')
        .limit(1);

      if (!run || run.status !== 'pending') return null;

      const existingAttempts = await tx
        .select()
        .from(taskAutomationRunAttempts)
        .where(eq(taskAutomationRunAttempts.runId, params.runId))
        .orderBy(asc(taskAutomationRunAttempts.attemptNumber));

      const active = existingAttempts.find(
        (a) =>
          a.status === 'running' &&
          a.leaseUntil &&
          new Date(a.leaseUntil).getTime() > now.getTime(),
      );
      if (active) return null;

      // Reclaim expired running attempt in place (same attemptNumber / idempotency key).
      const expired = existingAttempts.find(
        (a) =>
          a.status === 'running' &&
          (!a.leaseUntil || new Date(a.leaseUntil).getTime() <= now.getTime()),
      );

      if (expired) {
        const [attempt] = await tx
          .update(taskAutomationRunAttempts)
          .set({
            claimedBy: params.claimedBy,
            claimToken,
            leaseUntil,
            startedAt: now,
            status: 'running',
            updatedAt: now,
          })
          .where(
            and(
              eq(taskAutomationRunAttempts.id, expired.id),
              eq(taskAutomationRunAttempts.status, 'running'),
            ),
          )
          .returning();

        if (!attempt) return null;

        await tx
          .update(taskAutomationRuns)
          .set({ startedAt: run.startedAt ?? now, status: 'running', updatedAt: now })
          .where(eq(taskAutomationRuns.id, run.id));

        const [updatedRun] = await tx
          .select()
          .from(taskAutomationRuns)
          .where(eq(taskAutomationRuns.id, run.id))
          .limit(1);

        return {
          attempt,
          claimToken,
          created: false,
          run: updatedRun!,
        };
      }

      const nextNumber =
        existingAttempts.length === 0
          ? 1
          : Math.max(...existingAttempts.map((a) => a.attemptNumber)) + 1;

      const idempotencyKey = buildOperationIdempotencyKey(run.id, nextNumber);
      const attemptValues: NewTaskAutomationRunAttempt = {
        attemptNumber: nextNumber,
        claimedBy: params.claimedBy,
        claimToken,
        leaseUntil,
        operationIdempotencyKey: idempotencyKey,
        reason: existingAttempts.length === 0 ? 'dispatch' : 'recover',
        runId: run.id,
        startedAt: now,
        status: 'running',
      };

      const [attempt] = await tx
        .insert(taskAutomationRunAttempts)
        .values(attemptValues)
        .returning();

      await tx
        .update(taskAutomationRuns)
        .set({
          attemptCount: nextNumber,
          startedAt: run.startedAt ?? now,
          status: 'running',
          updatedAt: now,
        })
        .where(eq(taskAutomationRuns.id, run.id));

      const [updatedRun] = await tx
        .select()
        .from(taskAutomationRuns)
        .where(eq(taskAutomationRuns.id, run.id))
        .limit(1);

      return {
        attempt,
        claimToken,
        created: true,
        run: updatedRun!,
      };
    });
  }

  async bindOperation(params: {
    attemptId: string;
    claimToken: string;
    operationId: string;
    topicId?: string | null;
  }): Promise<boolean> {
    const now = new Date();
    const [attempt] = await this.db
      .update(taskAutomationRunAttempts)
      .set({
        operationId: params.operationId,
        topicId: params.topicId ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(taskAutomationRunAttempts.id, params.attemptId),
          eq(taskAutomationRunAttempts.claimToken, params.claimToken),
        ),
      )
      .returning();

    if (!attempt) return false;

    await this.db
      .update(taskAutomationRuns)
      .set({
        operationId: params.operationId,
        topicId: params.topicId ?? null,
        updatedAt: now,
      })
      .where(eq(taskAutomationRuns.id, attempt.runId));

    return true;
  }

  async extendLease(params: {
    attemptId: string;
    claimToken: string;
    leaseSeconds?: number;
  }): Promise<boolean> {
    const leaseSeconds = params.leaseSeconds ?? 120;
    const leaseUntil = new Date(Date.now() + leaseSeconds * 1000);
    const [row] = await this.db
      .update(taskAutomationRunAttempts)
      .set({ leaseUntil, updatedAt: new Date() })
      .where(
        and(
          eq(taskAutomationRunAttempts.id, params.attemptId),
          eq(taskAutomationRunAttempts.claimToken, params.claimToken),
          eq(taskAutomationRunAttempts.status, 'running'),
        ),
      )
      .returning({ id: taskAutomationRunAttempts.id });
    return Boolean(row);
  }

  async completeAttempt(params: {
    attemptId: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    status: Extract<TaskAutomationAttemptStatus, 'succeeded' | 'failed' | 'skipped' | 'canceled'>;
  }): Promise<{ attempt: TaskAutomationRunAttemptItem; run: TaskAutomationRunItem } | null> {
    const now = new Date();
    const runStatus: TaskAutomationRunStatus = params.status;

    return this.db.transaction(async (tx) => {
      const [attempt] = await tx
        .update(taskAutomationRunAttempts)
        .set({
          errorCode: params.errorCode ?? null,
          errorMessage: params.errorMessage ?? null,
          finishedAt: now,
          leaseUntil: null,
          status: params.status,
          updatedAt: now,
        })
        .where(eq(taskAutomationRunAttempts.id, params.attemptId))
        .returning();

      if (!attempt) return null;

      const [run] = await tx
        .update(taskAutomationRuns)
        .set({
          errorCode: params.errorCode ?? null,
          errorMessage: params.errorMessage ?? null,
          finishedAt: now,
          status: runStatus,
          updatedAt: now,
        })
        .where(eq(taskAutomationRuns.id, attempt.runId))
        .returning();

      if (!run) return null;
      return { attempt, run };
    });
  }

  /**
   * Mark attempt failed and return run to pending for retry (DB is authority).
   */
  async failAttemptForRetry(params: {
    attemptId: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    nextAttemptAt: Date;
  }): Promise<boolean> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [attempt] = await tx
        .update(taskAutomationRunAttempts)
        .set({
          errorCode: params.errorCode ?? null,
          errorMessage: params.errorMessage ?? null,
          finishedAt: now,
          leaseUntil: null,
          status: 'failed',
          updatedAt: now,
        })
        .where(eq(taskAutomationRunAttempts.id, params.attemptId))
        .returning();

      if (!attempt) return false;

      await tx
        .update(taskAutomationRuns)
        .set({
          errorCode: params.errorCode ?? null,
          errorMessage: params.errorMessage ?? null,
          nextAttemptAt: params.nextAttemptAt,
          status: 'pending',
          updatedAt: now,
        })
        .where(eq(taskAutomationRuns.id, attempt.runId));

      return true;
    });
  }

  /**
   * Expired running attempts whose lease has lapsed — recovery candidates.
   */
  async listExpiredAttempts(limit = 50, now = new Date()): Promise<TaskAutomationRunAttemptItem[]> {
    return this.db
      .select()
      .from(taskAutomationRunAttempts)
      .where(
        and(
          eq(taskAutomationRunAttempts.status, 'running'),
          lte(taskAutomationRunAttempts.leaseUntil, now),
        ),
      )
      .orderBy(asc(taskAutomationRunAttempts.leaseUntil))
      .limit(limit);
  }

  /**
   * Release an expired claim: if operation already exists, leave attempt running
   * but caller rebinds; if not, mark failed and re-pend the run.
   */
  async releaseExpiredAttempt(attemptId: string): Promise<{
    attempt: TaskAutomationRunAttemptItem;
    hasOperation: boolean;
    run: TaskAutomationRunItem;
  } | null> {
    return this.db.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(taskAutomationRunAttempts)
        .where(eq(taskAutomationRunAttempts.id, attemptId))
        .for('update')
        .limit(1);

      if (!attempt || attempt.status !== 'running') return null;
      if (attempt.leaseUntil && new Date(attempt.leaseUntil).getTime() > Date.now()) return null;

      const [run] = await tx
        .select()
        .from(taskAutomationRuns)
        .where(eq(taskAutomationRuns.id, attempt.runId))
        .for('update')
        .limit(1);

      if (!run) return null;

      if (attempt.operationId) {
        // Operation already started — leave attempt running; recovery will re-observe.
        return { attempt, hasOperation: true, run };
      }

      const now = new Date();
      const [failed] = await tx
        .update(taskAutomationRunAttempts)
        .set({
          errorCode: 'claim_expired',
          errorMessage: 'Claim lease expired before operation was bound',
          finishedAt: now,
          leaseUntil: null,
          status: 'failed',
          updatedAt: now,
        })
        .where(eq(taskAutomationRunAttempts.id, attempt.id))
        .returning();

      const [updatedRun] = await tx
        .update(taskAutomationRuns)
        .set({
          errorCode: 'claim_expired',
          errorMessage: 'Claim lease expired before operation was bound',
          nextAttemptAt: now,
          status: 'pending',
          updatedAt: now,
        })
        .where(eq(taskAutomationRuns.id, run.id))
        .returning();

      return {
        attempt: failed!,
        hasOperation: false,
        run: updatedRun!,
      };
    });
  }

  /**
   * Tasks with next_run_at <= now eligible for planning.
   * @param workspaceIds null = all; array = restrict (empty = none)
   * @param includePersonal when workspaceIds set, also include workspace_id IS NULL
   */
  async listDueTasks(
    limit = 200,
    now = new Date(),
    scope?: { includePersonal?: boolean; workspaceIds?: string[] },
  ) {
    const conditions = [
      lte(tasks.nextRunAt, now),
      inArray(tasks.automationMode, ['schedule', 'heartbeat']),
      sql`${tasks.status} NOT IN ('canceled', 'completed', 'failed', 'paused', 'running')`,
    ];

    const scopeClause = this.workspaceScopeClause(
      tasks.workspaceId,
      scope?.workspaceIds,
      scope?.includePersonal,
    );
    if (scopeClause === 'empty') return [];
    if (scopeClause) conditions.push(scopeClause);

    return this.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(asc(tasks.nextRunAt))
      .limit(limit);
  }

  /** Open (non-terminal) ledger runs — drain readiness. */
  async countOpenRuns(scope?: {
    includePersonal?: boolean;
    workspaceIds?: string[];
  }): Promise<number> {
    const conditions = [inArray(taskAutomationRuns.status, ['pending', 'running'])];
    const scopeClause = this.workspaceScopeClause(
      taskAutomationRuns.workspaceId,
      scope?.workspaceIds,
      scope?.includePersonal,
    );
    if (scopeClause === 'empty') return 0;
    if (scopeClause) conditions.push(scopeClause);

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskAutomationRuns)
      .where(and(...conditions));
    return Number(row?.count ?? 0);
  }

  async listDispatchableRuns(
    limit = 100,
    now = new Date(),
    scope?: { includePersonal?: boolean; workspaceIds?: string[] },
  ): Promise<TaskAutomationRunItem[]> {
    const conditions = [
      eq(taskAutomationRuns.status, 'pending'),
      or(isNull(taskAutomationRuns.nextAttemptAt), lte(taskAutomationRuns.nextAttemptAt, now)),
    ];
    const scopeClause = this.workspaceScopeClause(
      taskAutomationRuns.workspaceId,
      scope?.workspaceIds,
      scope?.includePersonal,
    );
    if (scopeClause === 'empty') return [];
    if (scopeClause) conditions.push(scopeClause);

    return this.db
      .select()
      .from(taskAutomationRuns)
      .where(and(...conditions))
      .orderBy(asc(taskAutomationRuns.plannedAt))
      .limit(limit);
  }

  private workspaceScopeClause(
    column: typeof tasks.workspaceId | typeof taskAutomationRuns.workspaceId,
    workspaceIds?: string[],
    includePersonal?: boolean,
  ) {
    if (workspaceIds === undefined) return null; // no filter
    const clauses = [];
    if (workspaceIds.length > 0) clauses.push(inArray(column, workspaceIds));
    if (includePersonal) clauses.push(isNull(column));
    if (clauses.length === 0) return 'empty' as const;
    if (clauses.length === 1) return clauses[0]!;
    return or(...clauses)!;
  }

  async setTaskNextRunAt(taskId: string, nextRunAt: Date | null): Promise<void> {
    await this.db
      .update(tasks)
      .set({ nextRunAt, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
  }

  async bumpAutomationRevision(taskId: string): Promise<number> {
    const [row] = await this.db
      .update(tasks)
      .set({
        automationRevision: sql`${tasks.automationRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
      .returning({ automationRevision: tasks.automationRevision });
    return row?.automationRevision ?? 0;
  }

  async insertEventRun(params: {
    automationRevision: number;
    plannedAt: Date;
    sourceEventId: string;
    taskId: string;
    userId: string;
    workspaceId?: string | null;
  }): Promise<{ created: boolean; run: TaskAutomationRunItem }> {
    const dedupeKey = buildEventDedupeKey(params.taskId, params.sourceEventId);
    const values: NewTaskAutomationRun = {
      automationRevision: params.automationRevision,
      dedupeKey,
      plannedAt: params.plannedAt,
      status: 'pending',
      taskId: params.taskId,
      trigger: 'event',
      userId: params.userId,
      workspaceId: params.workspaceId ?? null,
    };

    const inserted = await this.db
      .insert(taskAutomationRuns)
      .values(values)
      .onConflictDoNothing({ target: taskAutomationRuns.dedupeKey })
      .returning();

    if (inserted[0]) return { created: true, run: inserted[0] };

    const [existing] = await this.db
      .select()
      .from(taskAutomationRuns)
      .where(eq(taskAutomationRuns.dedupeKey, dedupeKey))
      .limit(1);
    if (!existing) throw new Error(`event run missing after conflict: ${dedupeKey}`);
    return { created: false, run: existing };
  }

  async listRunsForTask(params: {
    cursor?: string | null;
    limit?: number;
    status?: TaskAutomationRunStatus | TaskAutomationRunStatus[];
    taskId: string;
    trigger?: TaskAutomationTrigger | TaskAutomationTrigger[];
  }): Promise<{ data: TaskAutomationRunItem[]; nextCursor: string | null }> {
    const limit = Math.min(params.limit ?? 20, 100);
    const conditions = [eq(taskAutomationRuns.taskId, params.taskId)];

    if (params.status) {
      const list = Array.isArray(params.status) ? params.status : [params.status];
      conditions.push(inArray(taskAutomationRuns.status, list));
    }
    if (params.trigger) {
      const list = Array.isArray(params.trigger) ? params.trigger : [params.trigger];
      conditions.push(inArray(taskAutomationRuns.trigger, list));
    }
    if (params.cursor) {
      conditions.push(sql`${taskAutomationRuns.plannedAt} < ${new Date(params.cursor)}`);
    }

    const rows = await this.db
      .select()
      .from(taskAutomationRuns)
      .where(and(...conditions))
      .orderBy(sql`${taskAutomationRuns.plannedAt} DESC`)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && data.length > 0 ? data.at(-1)!.plannedAt.toISOString() : null;
    return { data, nextCursor };
  }

  /** Re-open a terminal failed/skipped run for another attempt. */
  async retryRun(runId: string): Promise<TaskAutomationRunItem | null> {
    const now = new Date();
    const [run] = await this.db
      .update(taskAutomationRuns)
      .set({
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        nextAttemptAt: now,
        status: 'pending',
        updatedAt: now,
      })
      .where(
        and(
          eq(taskAutomationRuns.id, runId),
          inArray(taskAutomationRuns.status, ['failed', 'skipped']),
        ),
      )
      .returning();
    return run ?? null;
  }

  /** Cancel a not-yet-started plan. */
  async cancelRun(runId: string): Promise<TaskAutomationRunItem | null> {
    const now = new Date();
    const [run] = await this.db
      .update(taskAutomationRuns)
      .set({ finishedAt: now, status: 'canceled', updatedAt: now })
      .where(and(eq(taskAutomationRuns.id, runId), eq(taskAutomationRuns.status, 'pending')))
      .returning();
    return run ?? null;
  }

  /**
   * Record heartbeat next-check on the current running attempt/run.
   * Applied to tasks.next_run_at only on successful completion.
   */
  async setRunNextCheck(params: {
    effectiveNextCheckAt: Date;
    operationId: string;
    requestedNextCheckAt: Date;
  }): Promise<boolean> {
    const attempt = await this.findAttemptByOperationId(params.operationId);
    if (!attempt || attempt.status !== 'running') return false;

    const now = new Date();
    await this.db
      .update(taskAutomationRuns)
      .set({
        effectiveNextCheckAt: params.effectiveNextCheckAt,
        requestedNextCheckAt: params.requestedNextCheckAt,
        updatedAt: now,
      })
      .where(eq(taskAutomationRuns.id, attempt.runId));

    return true;
  }

  /** Long-running attempts past execution timeout (uses task.heartbeatTimeout). */
  async listTimedOutRunningAttempts(limit = 50, now = new Date()) {
    // Join attempt + run + task: running attempt whose started_at + timeout < now
    return this.db.execute(sql`
      SELECT a.id AS attempt_id, a.run_id, a.operation_id, a.started_at,
             r.task_id, r.user_id, r.workspace_id, t.heartbeat_timeout, t.identifier
      FROM task_automation_run_attempts a
      JOIN task_automation_runs r ON r.id = a.run_id
      JOIN tasks t ON t.id = r.task_id
      WHERE a.status = 'running'
        AND t.heartbeat_timeout IS NOT NULL
        AND a.started_at IS NOT NULL
        AND a.started_at < ${now} - make_interval(secs => t.heartbeat_timeout)
      LIMIT ${limit}
    `);
  }
}
