import type {
  OperationOutcomeStatus,
  OperationOutcomeType,
  VerifyRunStatus,
} from '@lobechat/types';
import { and, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import { today } from '@/utils/time';

import type {
  AgentOperationAppContext,
  AgentOperationError,
  AgentOperationInterruption,
  NewAgentOperation,
} from '../schemas/agentOperations';
import { agentOperations } from '../schemas/agentOperations';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/**
 * Verify rollup states. Aliases the single `VerifyRunStatus` source of truth in
 * `@lobechat/types` (which also backs the `verify_status` column enum and
 * `verify_runs.status`) so the three never drift.
 */
export type VerifyStatus = VerifyRunStatus;

export interface RecordOperationStartParams {
  agentId?: string | null;
  appContext?: AgentOperationAppContext;
  chatGroupId?: string | null;
  /**
   * Optional stable idempotency key. When set, concurrent/retried recordStart
   * for the same key returns the existing row instead of inserting a second op.
   */
  idempotencyKey?: string | null;
  maxSteps?: number;
  /**
   * Durable per-run metadata persisted on the operation row (jsonb). Carries the
   * Agent Signal run marker so server-side tools can read it back from the row
   * (`metadata.agentSignal`) at tool-call time.
   */
  metadata?: Record<string, unknown>;
  model?: string;
  modelRuntimeConfig?: Record<string, unknown>;
  operationId: string;
  parentOperationId?: string | null;
  provider?: string;
  startedAt?: Date;
  taskId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  trigger?: string;
}

export interface RecordOperationCompletionParams {
  completedAt?: Date;
  completionReason?:
    | 'done'
    | 'error'
    | 'interrupted'
    | 'max_steps'
    | 'cost_limit'
    | 'waiting_for_human'
    | 'waiting_for_async_tool';
  cost?: Record<string, unknown> | null;
  error?: AgentOperationError | null;
  interruption?: AgentOperationInterruption | null;
  llmCalls?: number | null;
  /** Backfill the executed model when it's only known at completion (e.g. a
   * heterogeneous run learns its real model from the CLI mid-stream). Omit to
   * keep the value seeded at `recordStart`. */
  model?: string | null;
  processingTimeMs?: number | null;
  /** Backfill the executed provider — see {@link RecordOperationCompletionParams.model}. */
  provider?: string | null;
  status:
    'running' | 'waiting_for_human' | 'waiting_for_async_tool' | 'done' | 'error' | 'interrupted';
  stepCount?: number | null;
  toolCalls?: number | null;
  totalCost?: number | null;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalTokens?: number | null;
  traceS3Key?: string | null;
  usage?: Record<string, unknown> | null;
}

export interface RecordOperationOutcomeParams {
  outcomeArtifactId?: string | null;
  outcomeErrorCode?: string | null;
  outcomePreviewUrl?: string | null;
  outcomeRetryable?: boolean | null;
  outcomeStatus: OperationOutcomeStatus;
  outcomeType?: OperationOutcomeType | null;
  outcomeVerifiedAt?: Date | null;
}

export class AgentOperationModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentOperations);

  /**
   * Insert the initial row when an operation is created. Idempotent via
   * `onConflictDoNothing` on the primary key so resumed operations don't
   * blow up on the second createOperation call.
   *
   * When `idempotencyKey` is set and a row already exists for that key,
   * returns the existing operation id without inserting.
   */
  async recordStart(params: RecordOperationStartParams): Promise<{ operationId: string }> {
    if (params.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(params.idempotencyKey);
      if (existing) return { operationId: existing.id };
    }

    const values: NewAgentOperation = {
      agentId: params.agentId ?? null,
      appContext: params.appContext,
      chatGroupId: params.chatGroupId ?? null,
      id: params.operationId,
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
      maxSteps: params.maxSteps,
      ...(params.metadata ? { metadata: params.metadata } : {}),
      model: params.model,
      modelRuntimeConfig: params.modelRuntimeConfig,
      parentOperationId: params.parentOperationId ?? null,
      provider: params.provider,
      startedAt: params.startedAt ?? new Date(),
      status: 'running',
      taskId: params.taskId ?? null,
      threadId: params.threadId ?? null,
      topicId: params.topicId ?? null,
      trigger: params.trigger,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    };

    try {
      await this.db.insert(agentOperations).values(values).onConflictDoNothing();
    } catch (error) {
      // Race on unique idempotency_key: another worker won the insert.
      if (params.idempotencyKey) {
        const existing = await this.findByIdempotencyKey(params.idempotencyKey);
        if (existing) return { operationId: existing.id };
      }
      throw error;
    }

    if (params.idempotencyKey) {
      // PK conflict path (same operationId re-inserted) or concurrent insert —
      // re-resolve by key so callers always get the canonical id.
      const resolved = await this.findByIdempotencyKey(params.idempotencyKey);
      if (resolved) return { operationId: resolved.id };
    }

    return { operationId: params.operationId };
  }

  async findByIdempotencyKey(idempotencyKey: string) {
    const [row] = await this.db
      .select()
      .from(agentOperations)
      .where(and(eq(agentOperations.idempotencyKey, idempotencyKey), this.ownership()))
      .limit(1);
    return row ?? null;
  }

  /**
   * Update the row when the operation reaches a terminal state. Scoped by
   * `userId` so a leaked operationId can't be used to flip another user's
   * row. No-op when the start row was never written.
   *
   * Terminal writes (`done` / `error` / `interrupted`) are CAS: they refuse to
   * overwrite an already-terminal row so a late worker cannot clobber a
   * watchdog/abandon finalizer. Returns whether this call won the write.
   */
  async recordCompletion(
    operationId: string,
    params: RecordOperationCompletionParams,
  ): Promise<boolean> {
    const updates: Partial<NewAgentOperation> = {
      completionReason: params.completionReason,
      status: params.status,
    };

    // Only set completedAt when explicitly provided so callers can mark a
    // non-terminal status (e.g. waiting_for_human) without falsely stamping
    // completion time.
    if (params.completedAt !== undefined) updates.completedAt = params.completedAt;
    if (params.processingTimeMs !== undefined) updates.processingTimeMs = params.processingTimeMs;
    if (params.stepCount !== undefined) updates.stepCount = params.stepCount;
    if (params.totalCost !== undefined) updates.totalCost = params.totalCost;
    if (params.totalTokens !== undefined) updates.totalTokens = params.totalTokens;
    if (params.totalInputTokens !== undefined) updates.totalInputTokens = params.totalInputTokens;
    if (params.totalOutputTokens !== undefined)
      updates.totalOutputTokens = params.totalOutputTokens;
    if (params.llmCalls !== undefined) updates.llmCalls = params.llmCalls;
    if (params.toolCalls !== undefined) updates.toolCalls = params.toolCalls;
    if (params.model !== undefined) updates.model = params.model;
    if (params.provider !== undefined) updates.provider = params.provider;
    if (params.cost !== undefined) updates.cost = params.cost;
    if (params.usage !== undefined) updates.usage = params.usage;
    if (params.error !== undefined) updates.error = params.error;
    if (params.interruption !== undefined) updates.interruption = params.interruption;
    if (params.traceS3Key !== undefined) updates.traceS3Key = params.traceS3Key;

    const [row] = await this.db
      .update(agentOperations)
      .set(updates)
      .where(
        and(
          eq(agentOperations.id, operationId),
          this.ownership(),
          or(
            isNull(agentOperations.status),
            inArray(agentOperations.status, [
              'idle',
              'running',
              'waiting_for_human',
              'waiting_for_async_tool',
            ]),
          ),
        ),
      )
      .returning({ id: agentOperations.id });
    return Boolean(row);
  }

  /**
   * Persist trusted delivery outcome separately from runtime completion.
   * Model prose never writes these fields — only tool/outbox verification.
   * Verified is sticky: failed/pending cannot overwrite a verified outcome
   * (stale worker / out-of-order create+update tool messages).
   */
  async recordOutcome(operationId: string, params: RecordOperationOutcomeParams): Promise<boolean> {
    const updates: Partial<NewAgentOperation> = {
      outcomeStatus: params.outcomeStatus,
    };
    if (params.outcomeType !== undefined) updates.outcomeType = params.outcomeType;
    if (params.outcomePreviewUrl !== undefined)
      updates.outcomePreviewUrl = params.outcomePreviewUrl;
    if (params.outcomeArtifactId !== undefined)
      updates.outcomeArtifactId = params.outcomeArtifactId;
    if (params.outcomeErrorCode !== undefined) updates.outcomeErrorCode = params.outcomeErrorCode;
    if (params.outcomeRetryable !== undefined) updates.outcomeRetryable = params.outcomeRetryable;
    if (params.outcomeVerifiedAt !== undefined)
      updates.outcomeVerifiedAt = params.outcomeVerifiedAt;

    const refuseDowngradeFromVerified =
      params.outcomeStatus !== 'verified'
        ? or(isNull(agentOperations.outcomeStatus), ne(agentOperations.outcomeStatus, 'verified'))
        : undefined;

    const [row] = await this.db
      .update(agentOperations)
      .set(updates)
      .where(
        and(eq(agentOperations.id, operationId), this.ownership(), refuseDowngradeFromVerified),
      )
      .returning({ id: agentOperations.id });
    return Boolean(row);
  }

  async mergeMetadata(operationId: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.findById(operationId);
    if (!row) return;
    await this.db
      .update(agentOperations)
      .set({ metadata: { ...row.metadata, ...patch } })
      .where(and(eq(agentOperations.id, operationId), this.ownership()));
  }

  async findById(operationId: string) {
    const [row] = await this.db
      .select()
      .from(agentOperations)
      .where(and(eq(agentOperations.id, operationId), this.ownership()))
      .limit(1);
    return row ?? null;
  }

  /**
   * Longest single operation (agent run) wall-clock execution time over the last
   * year, in seconds. Wall clock (`completedAt - startedAt`) is the most faithful
   * "task duration" — it spans the whole run including tool calls and waiting,
   * not just LLM compute. Returns 0 when there are no completed operations.
   */
  async getMaxDurationSeconds(): Promise<number> {
    const startDate = today().subtract(1, 'year').startOf('day').toDate();

    const [row] = await this.db
      .select({
        seconds:
          sql<number>`COALESCE(MAX(EXTRACT(EPOCH FROM (${agentOperations.completedAt} - ${agentOperations.startedAt}))), 0)`.mapWith(
            Number,
          ),
      })
      .from(agentOperations)
      .where(
        and(
          this.ownership(),
          isNotNull(agentOperations.startedAt),
          isNotNull(agentOperations.completedAt),
          gte(agentOperations.createdAt, startDate),
        ),
      );

    return row?.seconds ?? 0;
  }

  /**
   * Atomically flip a parked parent op from `waiting_for_async_tool` back to
   * `running`. Returns true only for the single winner (affected === 1) so
   * concurrent sub-op completions that lose the race no-op instead of
   * double-resuming the parent.
   */
  async tryResumeFromAsyncTool(operationId: string): Promise<boolean> {
    const rows = await this.db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.userId, this.userId),
          eq(agentOperations.status, 'waiting_for_async_tool'),
        ),
      )
      .returning({ id: agentOperations.id });
    return rows.length === 1;
  }

  // ============================================
  // Verify (delivery checker)
  // ============================================
  // The verify plan snapshot + rollup status moved off this table onto
  // `verify_runs` (the session entity), addressed via `VerifyRunModel`. The
  // `verify_plan` / `verify_status` columns here are deprecated (see schema) and
  // no longer read or written through this model.
}
