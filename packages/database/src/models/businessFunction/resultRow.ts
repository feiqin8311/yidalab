import { and, asc, count, desc, eq, ilike, type SQL, sql } from 'drizzle-orm';

import { businessFunctionResultRows, type NewBusinessFunctionResultRow } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

const SORT_COLUMNS = {
  orders: businessFunctionResultRows.sortOrders,
  spend: businessFunctionResultRows.sortSpend,
  score: businessFunctionResultRows.sortScore,
  rank: businessFunctionResultRows.sortRank,
  createdAt: businessFunctionResultRows.createdAt,
} as const;

export type ResultRowSortKey = keyof typeof SORT_COLUMNS;

export class BusinessFunctionResultRowModel {
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
      businessFunctionResultRows,
    );

  /** Idempotent batch upsert by (runId, viewId, rowKey). */
  upsertBatch = async (
    items: Omit<NewBusinessFunctionResultRow, 'userId' | 'workspaceId' | 'id'>[],
  ) => {
    if (!items.length) return { count: 0 };
    const values = items.map((item) => ({
      ...item,
      userId: this.userId,
      workspaceId: this.workspaceId!,
    }));

    // chunk to avoid parameter limits
    const CHUNK = 200;
    let total = 0;
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK);
      await this.db
        .insert(businessFunctionResultRows)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            businessFunctionResultRows.runId,
            businessFunctionResultRows.viewId,
            businessFunctionResultRows.rowKey,
          ],
          set: {
            data: sql`excluded.data`,
            searchText: sql`excluded.search_text`,
            sortOrders: sql`excluded.sort_orders`,
            sortSpend: sql`excluded.sort_spend`,
            sortScore: sql`excluded.sort_score`,
            sortRank: sql`excluded.sort_rank`,
            updatedAt: new Date(),
          },
        });
      total += chunk.length;
    }
    return { count: total };
  };

  /** Workflow path with explicit user/workspace. */
  upsertBatchAs = async (
    userId: string,
    workspaceId: string,
    items: Omit<NewBusinessFunctionResultRow, 'userId' | 'workspaceId' | 'id'>[],
  ) => {
    if (!items.length) return { count: 0 };
    const values = items.map((item) => ({ ...item, userId, workspaceId }));
    const CHUNK = 200;
    let total = 0;
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK);
      await this.db
        .insert(businessFunctionResultRows)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            businessFunctionResultRows.runId,
            businessFunctionResultRows.viewId,
            businessFunctionResultRows.rowKey,
          ],
          set: {
            data: sql`excluded.data`,
            searchText: sql`excluded.search_text`,
            sortOrders: sql`excluded.sort_orders`,
            sortSpend: sql`excluded.sort_spend`,
            sortScore: sql`excluded.sort_score`,
            sortRank: sql`excluded.sort_rank`,
            updatedAt: new Date(),
          },
        });
      total += chunk.length;
    }
    return { count: total };
  };

  deleteByRunId = async (runId: string) => {
    return this.db
      .delete(businessFunctionResultRows)
      .where(and(eq(businessFunctionResultRows.runId, runId), this.ownership()));
  };

  deleteByRunIdUnscoped = async (runId: string) => {
    return this.db
      .delete(businessFunctionResultRows)
      .where(eq(businessFunctionResultRows.runId, runId));
  };

  query = async (params: {
    runId: string;
    viewId: string;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: ResultRowSortKey;
    sortDir?: 'asc' | 'desc';
  }) => {
    const conditions: SQL[] = [
      this.ownership(),
      eq(businessFunctionResultRows.runId, params.runId),
      eq(businessFunctionResultRows.viewId, params.viewId),
    ];
    if (params.search?.trim()) {
      conditions.push(ilike(businessFunctionResultRows.searchText, `%${params.search.trim()}%`));
    }

    const sortCol =
      SORT_COLUMNS[params.sortBy ?? 'orders'] ?? businessFunctionResultRows.sortOrders;
    const order = params.sortDir === 'asc' ? asc(sortCol) : desc(sortCol);

    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(businessFunctionResultRows)
        .where(and(...conditions))
        .orderBy(order)
        .limit(limit)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(businessFunctionResultRows)
        .where(and(...conditions)),
    ]);

    return {
      rows,
      total: Number(totalRow[0]?.value) || 0,
      limit,
      offset,
    };
  };

  /** Load all rows for a view (export). */
  listAllForView = async (runId: string, viewId: string) => {
    return this.db
      .select()
      .from(businessFunctionResultRows)
      .where(
        and(
          eq(businessFunctionResultRows.runId, runId),
          eq(businessFunctionResultRows.viewId, viewId),
        ),
      )
      .orderBy(
        desc(businessFunctionResultRows.sortOrders),
        desc(businessFunctionResultRows.sortScore),
      );
  };
}
