import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

export const BUSINESS_FUNCTION_RUN_STATUSES = [
  'draft',
  'auditing',
  'queued',
  'running',
  'exporting',
  'succeeded',
  'failed',
  'canceled',
] as const;

export type BusinessFunctionRunStatus = (typeof BUSINESS_FUNCTION_RUN_STATUSES)[number];

export type BusinessFunctionRunConfig = {
  marketplace?: string;
  mainAsin: string;
  categoryName: string;
  priceUsd: number;
  thresholds: {
    targetAcos: number;
    highRiskAcos: number;
    wasteSpendRatioToPrice: number;
    wasteClicks: number;
    highRelevanceScore: number;
    coreRelevanceScore: number;
  };
  model: { provider: string; model: string };
  sourceManifest?: Record<
    string,
    {
      role: string;
      fileName: string;
      s3Key: string;
      size: number;
      contentType?: string;
      sheetNames?: string[];
      dateRange?: { start?: string; end?: string };
      rawRowCount?: number;
      includedRowCount?: number;
      missing?: boolean;
      notes?: string[];
    }
  >;
  productProfile?: Record<string, unknown>;
  auditReport?: Record<string, unknown>;
  aiBatchProgress?: { done: number; total: number; failedBatches?: number[] };
};

export type BusinessFunctionRunProgress = {
  stage: string;
  stageLabel?: string;
  percent: number;
  batchIndex?: number;
  batchTotal?: number;
  keywordTotal?: number;
  keywordDone?: number;
  message?: string;
};

export type BusinessFunctionRunSummary = Record<string, unknown>;

export type BusinessFunctionRunError = {
  code: string;
  message: string;
  stage?: string;
  batchIndex?: number;
  retryable?: boolean;
  details?: unknown;
};

export type BusinessFunctionExportInfo = {
  status: 'idle' | 'pending' | 'running' | 'succeeded' | 'failed';
  s3Key?: string;
  fileName?: string;
  size?: number;
  error?: string;
  generatedAt?: string;
};

export const businessFunctionRuns = pgTable(
  'business_function_runs',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('businessFunctionRuns'))
      .primaryKey(),

    functionType: text('function_type').notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),

    mainAsin: text('main_asin'),
    categoryName: text('category_name'),

    status: text('status', { enum: BUSINESS_FUNCTION_RUN_STATUSES }).default('draft').notNull(),
    stage: text('stage').default('draft').notNull(),
    cancelRequested: integer('cancel_requested').default(0).notNull(),

    config: jsonb('config')
      .$type<BusinessFunctionRunConfig>()
      .notNull()
      .default({} as any),
    progress: jsonb('progress').$type<BusinessFunctionRunProgress>(),
    summary: jsonb('summary').$type<BusinessFunctionRunSummary>(),
    error: jsonb('error').$type<BusinessFunctionRunError>(),
    exportInfo: jsonb('export_info').$type<BusinessFunctionExportInfo>(),

    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),

    ...timestamps,
  },
  (t) => [
    index('business_function_runs_user_id_idx').on(t.userId),
    index('business_function_runs_workspace_id_idx').on(t.workspaceId),
    index('business_function_runs_status_idx').on(t.status),
    index('business_function_runs_function_type_idx').on(t.functionType),
    index('business_function_runs_workspace_asin_idx').on(t.workspaceId, t.mainAsin),
    index('business_function_runs_created_at_idx').on(t.createdAt),
  ],
);

export type NewBusinessFunctionRun = typeof businessFunctionRuns.$inferInsert;
export type BusinessFunctionRunItem = typeof businessFunctionRuns.$inferSelect;

export const businessFunctionResultRows = pgTable(
  'business_function_result_rows',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('businessFunctionResultRows'))
      .primaryKey(),

    runId: text('run_id')
      .references(() => businessFunctionRuns.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),

    viewId: text('view_id').notNull(),
    rowKey: text('row_key').notNull(),
    searchText: text('search_text'),

    sortOrders: doublePrecision('sort_orders'),
    sortSpend: doublePrecision('sort_spend'),
    sortScore: doublePrecision('sort_score'),
    sortRank: doublePrecision('sort_rank'),

    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('business_function_result_rows_run_view_key_uidx').on(t.runId, t.viewId, t.rowKey),
    index('business_function_result_rows_run_view_idx').on(t.runId, t.viewId),
    index('business_function_result_rows_workspace_id_idx').on(t.workspaceId),
    index('business_function_result_rows_user_id_idx').on(t.userId),
    index('business_function_result_rows_search_text_idx').on(t.searchText),
  ],
);

export type NewBusinessFunctionResultRow = typeof businessFunctionResultRows.$inferInsert;
export type BusinessFunctionResultRowItem = typeof businessFunctionResultRows.$inferSelect;
