import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { DeliveryAttemptItem, NewDeliveryAttempt } from '../schemas/deliveryAttempt';
import { deliveryAttempts } from '../schemas/deliveryAttempt';
import type { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspaceWhere } from '../utils/workspace';

export interface EnqueueDeliveryParams {
  artifactHash?: string;
  dedupeKey: string;
  deliveryType: NewDeliveryAttempt['deliveryType'];
  metadata?: Record<string, unknown>;
  operationId: string;
  targetFolder?: string;
}

export interface MarkDeliveryRunningParams {
  claimedBy?: string;
  claimToken: string;
  leaseMs?: number;
}

export interface MarkDeliverySucceededParams {
  artifactId?: string;
  /** Required — CAS fence; only the holding claim may close success. */
  claimToken: string;
  fileId?: string;
  metadata?: Record<string, unknown>;
  previewUrl: string;
  spaceId?: string;
  verificationStatus?: 'verified' | 'unverified';
}

export interface MarkDeliveryFailedParams {
  /** Required when failing a claimed (running) attempt. */
  claimToken: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  nextAttemptAt?: Date;
  retryable?: boolean;
}

export interface MarkDeliveryDeadLetterParams {
  errorCode?: string;
  errorMessage?: string;
  /** Must still be failed + retryable with this attempt count. */
  expectedAttempt: number;
}

export class DeliveryAttemptModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, deliveryAttempts);

  /**
   * Insert or return existing outbox row for the unique delivery key.
   * Concurrent enqueues race safely via unique constraint.
   */
  async enqueue(params: EnqueueDeliveryParams): Promise<DeliveryAttemptItem> {
    const values: NewDeliveryAttempt = {
      artifactHash: params.artifactHash ?? 'report',
      dedupeKey: params.dedupeKey,
      deliveryType: params.deliveryType,
      id: idGenerator('deliveryAttempts'),
      metadata: params.metadata ?? {},
      operationId: params.operationId,
      status: 'pending',
      targetFolder: params.targetFolder ?? 'default',
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    };

    try {
      const [row] = await this.db
        .insert(deliveryAttempts)
        .values(values)
        .onConflictDoNothing()
        .returning();
      if (row) return row;
    } catch {
      /* unique race — fall through to select */
    }

    const existing = await this.findByDedupeKey(params.dedupeKey);
    if (existing) return existing;
    throw new Error(`delivery enqueue failed for ${params.dedupeKey}`);
  }

  async findByDedupeKey(dedupeKey: string): Promise<DeliveryAttemptItem | null> {
    const [row] = await this.db
      .select()
      .from(deliveryAttempts)
      .where(and(eq(deliveryAttempts.dedupeKey, dedupeKey), this.ownership()))
      .limit(1);
    return row ?? null;
  }

  async findByOperationId(operationId: string): Promise<DeliveryAttemptItem[]> {
    return this.db
      .select()
      .from(deliveryAttempts)
      .where(and(eq(deliveryAttempts.operationId, operationId), this.ownership()));
  }

  async findSuccessfulByOperation(
    operationId: string,
    deliveryType?: NewDeliveryAttempt['deliveryType'],
  ): Promise<DeliveryAttemptItem | null> {
    const conditions = [
      eq(deliveryAttempts.operationId, operationId),
      eq(deliveryAttempts.status, 'succeeded'),
      this.ownership(),
    ];
    if (deliveryType) conditions.push(eq(deliveryAttempts.deliveryType, deliveryType));

    const [row] = await this.db
      .select()
      .from(deliveryAttempts)
      .where(and(...conditions))
      .limit(1);
    return row ?? null;
  }

  /**
   * Claim a pending/retryable row for work. Returns null if another worker won
   * or the row is already terminal-success.
   */
  async tryClaim(
    id: string,
    params: MarkDeliveryRunningParams,
  ): Promise<DeliveryAttemptItem | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + (params.leaseMs ?? 120_000));

    const [row] = await this.db
      .update(deliveryAttempts)
      .set({
        attempt: sql`${deliveryAttempts.attempt} + 1`,
        claimToken: params.claimToken,
        claimedBy: params.claimedBy ?? null,
        leaseUntil,
        startedAt: now,
        status: 'running',
        updatedAt: now,
      })
      .where(
        and(
          eq(deliveryAttempts.id, id),
          this.ownership(),
          or(
            eq(deliveryAttempts.status, 'pending'),
            and(
              eq(deliveryAttempts.status, 'failed'),
              eq(deliveryAttempts.retryable, true),
              or(
                sql`${deliveryAttempts.nextAttemptAt} IS NULL`,
                lt(deliveryAttempts.nextAttemptAt, now),
              ),
            ),
            and(eq(deliveryAttempts.status, 'running'), lt(deliveryAttempts.leaseUntil, now)),
          ),
        ),
      )
      .returning();

    return row ?? null;
  }

  async markSucceeded(
    id: string,
    params: MarkDeliverySucceededParams,
  ): Promise<DeliveryAttemptItem | null> {
    const now = new Date();
    const verificationStatus = params.verificationStatus ?? 'verified';
    if (!params.claimToken) return null;
    const [row] = await this.db
      .update(deliveryAttempts)
      .set({
        artifactId: params.artifactId ?? null,
        completedAt: now,
        errorCode: null,
        errorMessage: null,
        fileId: params.fileId ?? null,
        previewUrl: params.previewUrl,
        retryable: false,
        spaceId: params.spaceId ?? null,
        status: 'succeeded',
        updatedAt: now,
        verificationStatus,
        verifiedAt: verificationStatus === 'verified' ? now : null,
        ...(params.metadata ? { metadata: params.metadata } : {}),
      })
      .where(
        and(
          eq(deliveryAttempts.id, id),
          this.ownership(),
          eq(deliveryAttempts.claimToken, params.claimToken),
          eq(deliveryAttempts.status, 'running'),
        ),
      )
      .returning();
    return row ?? null;
  }

  async markFailed(
    id: string,
    params: MarkDeliveryFailedParams,
  ): Promise<DeliveryAttemptItem | null> {
    const now = new Date();
    if (!params.claimToken) return null;
    const [row] = await this.db
      .update(deliveryAttempts)
      .set({
        completedAt: now,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        nextAttemptAt: params.nextAttemptAt ?? null,
        retryable: params.retryable ?? true,
        status: 'failed',
        updatedAt: now,
        verificationStatus: 'failed',
        ...(params.metadata ? { metadata: params.metadata } : {}),
      })
      .where(
        and(
          eq(deliveryAttempts.id, id),
          this.ownership(),
          eq(deliveryAttempts.claimToken, params.claimToken),
          eq(deliveryAttempts.status, 'running'),
        ),
      )
      .returning();
    return row ?? null;
  }

  async findById(id: string): Promise<DeliveryAttemptItem | null> {
    const [row] = await this.db
      .select()
      .from(deliveryAttempts)
      .where(and(eq(deliveryAttempts.id, id), this.ownership()))
      .limit(1);
    return row ?? null;
  }

  /**
   * Schedule a manual redrive: failed/pending → pending with nextAttemptAt=now.
   * Succeeded rows are left alone unless force=true (creates no new row; flips to pending).
   */
  async requestRedrive(id: string, force = false): Promise<DeliveryAttemptItem | null> {
    const now = new Date();
    const [row] = await this.db
      .update(deliveryAttempts)
      .set({
        errorCode: null,
        errorMessage: null,
        nextAttemptAt: now,
        retryable: true,
        status: 'pending',
        updatedAt: now,
        verificationStatus: 'unverified',
      })
      .where(
        and(
          eq(deliveryAttempts.id, id),
          this.ownership(),
          force
            ? sql`true`
            : or(
                eq(deliveryAttempts.status, 'failed'),
                eq(deliveryAttempts.status, 'pending'),
                and(eq(deliveryAttempts.status, 'running'), lt(deliveryAttempts.leaseUntil, now)),
              ),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Global drain query (no user scope) — worker only.
   * pending | retryable failed past nextAttemptAt | expired running leases.
   */
  static async listDispatchable(
    db: LobeChatDatabase,
    limit = 20,
    now = new Date(),
  ): Promise<DeliveryAttemptItem[]> {
    return db
      .select()
      .from(deliveryAttempts)
      .where(
        or(
          and(
            eq(deliveryAttempts.status, 'pending'),
            or(isNull(deliveryAttempts.nextAttemptAt), lt(deliveryAttempts.nextAttemptAt, now)),
          ),
          and(
            eq(deliveryAttempts.status, 'failed'),
            eq(deliveryAttempts.retryable, true),
            or(isNull(deliveryAttempts.nextAttemptAt), lt(deliveryAttempts.nextAttemptAt, now)),
          ),
          and(eq(deliveryAttempts.status, 'running'), lt(deliveryAttempts.leaseUntil, now)),
        ),
      )
      .orderBy(asc(deliveryAttempts.createdAt))
      .limit(limit);
  }

  /** Dead-letter: failed + not retryable (or attempt exhausted via metadata). */
  static async listDeadLetters(db: LobeChatDatabase, limit = 50): Promise<DeliveryAttemptItem[]> {
    return db
      .select()
      .from(deliveryAttempts)
      .where(and(eq(deliveryAttempts.status, 'failed'), eq(deliveryAttempts.retryable, false)))
      .orderBy(asc(deliveryAttempts.completedAt))
      .limit(limit);
  }

  static async countByStatus(db: LobeChatDatabase): Promise<Record<string, number>> {
    const rows = await db
      .select({
        count: sql<number>`count(*)::int`.mapWith(Number),
        status: deliveryAttempts.status,
      })
      .from(deliveryAttempts)
      .groupBy(deliveryAttempts.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.count;
    return out;
  }

  /**
   * System claim without user ownership filter (worker drain).
   */
  static async tryClaimGlobal(
    db: LobeChatDatabase,
    id: string,
    params: MarkDeliveryRunningParams,
  ): Promise<DeliveryAttemptItem | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + (params.leaseMs ?? 120_000));
    const [row] = await db
      .update(deliveryAttempts)
      .set({
        attempt: sql`${deliveryAttempts.attempt} + 1`,
        claimToken: params.claimToken,
        claimedBy: params.claimedBy ?? null,
        leaseUntil,
        startedAt: now,
        status: 'running',
        updatedAt: now,
      })
      .where(
        and(
          eq(deliveryAttempts.id, id),
          or(
            eq(deliveryAttempts.status, 'pending'),
            and(
              eq(deliveryAttempts.status, 'failed'),
              eq(deliveryAttempts.retryable, true),
              or(isNull(deliveryAttempts.nextAttemptAt), lt(deliveryAttempts.nextAttemptAt, now)),
            ),
            and(eq(deliveryAttempts.status, 'running'), lt(deliveryAttempts.leaseUntil, now)),
          ),
        ),
      )
      .returning();
    return row ?? null;
  }

  static async markSucceededGlobal(
    db: LobeChatDatabase,
    id: string,
    params: MarkDeliverySucceededParams,
  ): Promise<DeliveryAttemptItem | null> {
    const now = new Date();
    const verificationStatus = params.verificationStatus ?? 'verified';
    if (!params.claimToken) return null;
    const [row] = await db
      .update(deliveryAttempts)
      .set({
        artifactId: params.artifactId ?? null,
        completedAt: now,
        errorCode: null,
        errorMessage: null,
        fileId: params.fileId ?? null,
        previewUrl: params.previewUrl,
        retryable: false,
        spaceId: params.spaceId ?? null,
        status: 'succeeded',
        updatedAt: now,
        verificationStatus,
        verifiedAt: verificationStatus === 'verified' ? now : null,
        ...(params.metadata ? { metadata: params.metadata } : {}),
      })
      .where(
        and(
          eq(deliveryAttempts.id, id),
          eq(deliveryAttempts.claimToken, params.claimToken),
          eq(deliveryAttempts.status, 'running'),
        ),
      )
      .returning();
    return row ?? null;
  }

  static async markFailedGlobal(
    db: LobeChatDatabase,
    id: string,
    params: MarkDeliveryFailedParams,
  ): Promise<DeliveryAttemptItem | null> {
    const now = new Date();
    if (!params.claimToken) return null;
    const [row] = await db
      .update(deliveryAttempts)
      .set({
        completedAt: now,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        nextAttemptAt: params.nextAttemptAt ?? null,
        retryable: params.retryable ?? true,
        status: 'failed',
        updatedAt: now,
        verificationStatus: 'failed',
        ...(params.metadata ? { metadata: params.metadata } : {}),
      })
      .where(
        and(
          eq(deliveryAttempts.id, id),
          eq(deliveryAttempts.claimToken, params.claimToken),
          eq(deliveryAttempts.status, 'running'),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Dead-letter a failed row without a claim — CAS on status=failed + attempt.
   * Never touches running/succeeded.
   */
  static async markDeadLetterGlobal(
    db: LobeChatDatabase,
    id: string,
    params: MarkDeliveryDeadLetterParams,
  ): Promise<DeliveryAttemptItem | null> {
    const now = new Date();
    const [row] = await db
      .update(deliveryAttempts)
      .set({
        completedAt: now,
        errorCode: params.errorCode ?? 'max_attempts',
        errorMessage: params.errorMessage ?? 'max delivery attempts exceeded',
        nextAttemptAt: null,
        retryable: false,
        status: 'failed',
        updatedAt: now,
        verificationStatus: 'failed',
      })
      .where(
        and(
          eq(deliveryAttempts.id, id),
          eq(deliveryAttempts.status, 'failed'),
          eq(deliveryAttempts.retryable, true),
          eq(deliveryAttempts.attempt, params.expectedAttempt),
        ),
      )
      .returning();
    return row ?? null;
  }
}
