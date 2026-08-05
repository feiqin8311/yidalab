import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import {
  type BusinessFunctionRunItem,
  businessFunctionRuns,
  type NewBusinessFunctionRun,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

const ACTIVE_STATUSES = ['draft', 'auditing', 'queued', 'running', 'exporting'] as const;

export class BusinessFunctionRunModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      businessFunctionRuns,
    );

  create = async (params: Omit<NewBusinessFunctionRun, 'userId' | 'workspaceId'>) => {
    const [result] = await this.db
      .insert(businessFunctionRuns)
      .values({
        ...params,
        userId: this.userId,
        workspaceId: this.workspaceId!,
      })
      .returning();
    return result;
  };

  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(businessFunctionRuns)
      .where(and(eq(businessFunctionRuns.id, id), this.ownership()))
      .limit(1);
    return result as BusinessFunctionRunItem | undefined;
  };

  /**
   * Internal workflow access by id only.
   * Callers MUST validate run.userId / run.workspaceId against the job payload.
   */
  findByIdUnscoped = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(businessFunctionRuns)
      .where(eq(businessFunctionRuns.id, id))
      .limit(1);
    return result as BusinessFunctionRunItem | undefined;
  };

  /**
   * Atomically claim export: only idle/failed/null → pending.
   * Returns the updated row, or undefined if another worker already claimed it.
   */
  claimExport = async (id: string) => {
    const [result] = await this.db
      .update(businessFunctionRuns)
      .set({
        exportInfo: { status: 'pending' } as any,
        status: 'exporting',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessFunctionRuns.id, id),
          this.ownership(),
          sql`(
            ${businessFunctionRuns.exportInfo} IS NULL
            OR ${businessFunctionRuns.exportInfo}->>'status' IS NULL
            OR ${businessFunctionRuns.exportInfo}->>'status' IN ('idle', 'failed')
          )`,
        ),
      )
      .returning();
    return result as BusinessFunctionRunItem | undefined;
  };

  /**
   * Conditionally release a pending export claim after dispatch failure.
   * Only succeeds when export_info.status is still 'pending' — will not clobber
   * a workflow that already advanced to running/succeeded.
   */
  releaseExportClaim = async (id: string, message: string) => {
    const [result] = await this.db
      .update(businessFunctionRuns)
      .set({
        status: 'succeeded',
        exportInfo: { status: 'failed', error: message } as any,
        progress: { stage: 'done', percent: 100, message: `导出入队失败：${message}` } as any,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessFunctionRuns.id, id),
          this.ownership(),
          sql`${businessFunctionRuns.exportInfo}->>'status' = 'pending'`,
        ),
      )
      .returning();
    return result as BusinessFunctionRunItem | undefined;
  };

  query = async (filter?: {
    functionType?: string;
    limit?: number;
    offset?: number;
    status?: string | string[];
  }) => {
    const conditions = [this.ownership()];
    if (filter?.functionType) {
      conditions.push(eq(businessFunctionRuns.functionType, filter.functionType));
    }
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(inArray(businessFunctionRuns.status, statuses as any));
    }

    const query = this.db
      .select()
      .from(businessFunctionRuns)
      .where(and(...conditions))
      .orderBy(desc(businessFunctionRuns.createdAt))
      .$dynamic();

    if (filter?.limit !== undefined) query.limit(filter.limit);
    if (filter?.offset !== undefined) query.offset(filter.offset);

    return query;
  };

  count = async (filter?: { functionType?: string }) => {
    const conditions = [this.ownership()];
    if (filter?.functionType) {
      conditions.push(eq(businessFunctionRuns.functionType, filter.functionType));
    }
    const [row] = await this.db
      .select({ value: count() })
      .from(businessFunctionRuns)
      .where(and(...conditions));
    return Number(row?.value) || 0;
  };

  update = async (id: string, value: Partial<NewBusinessFunctionRun>) => {
    const [result] = await this.db
      .update(businessFunctionRuns)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(businessFunctionRuns.id, id), this.ownership()))
      .returning();
    return result as BusinessFunctionRunItem | undefined;
  };

  /** Workflow updates without ownership filter (server-side job). */
  updateById = async (id: string, value: Partial<NewBusinessFunctionRun>) => {
    const [result] = await this.db
      .update(businessFunctionRuns)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(businessFunctionRuns.id, id))
      .returning();
    return result as BusinessFunctionRunItem | undefined;
  };

  requestCancel = async (id: string) => {
    return this.update(id, { cancelRequested: 1 } as any);
  };

  delete = async (id: string) => {
    return this.db
      .delete(businessFunctionRuns)
      .where(and(eq(businessFunctionRuns.id, id), this.ownership()));
  };

  /** Same workspace + main ASIN may have only one active run. */
  findActiveByAsin = async (functionType: string, mainAsin: string, excludeId?: string) => {
    if (!this.workspaceId) return undefined;
    const conditions = [
      eq(businessFunctionRuns.workspaceId, this.workspaceId),
      eq(businessFunctionRuns.functionType, functionType),
      eq(businessFunctionRuns.mainAsin, mainAsin),
      inArray(businessFunctionRuns.status, ACTIVE_STATUSES as any),
    ];
    if (excludeId) conditions.push(ne(businessFunctionRuns.id, excludeId));
    const [result] = await this.db
      .select()
      .from(businessFunctionRuns)
      .where(and(...conditions))
      .limit(1);
    return result as BusinessFunctionRunItem | undefined;
  };

  isCancelRequested = async (id: string) => {
    const [row] = await this.db
      .select({ cancelRequested: businessFunctionRuns.cancelRequested })
      .from(businessFunctionRuns)
      .where(eq(businessFunctionRuns.id, id))
      .limit(1);
    return Number(row?.cancelRequested) === 1;
  };
}
