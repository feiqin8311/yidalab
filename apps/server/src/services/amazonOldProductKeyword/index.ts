import {
  type AnalysisThresholds,
  DATA_SOURCE_ROLES,
  type DataSourceNote,
  type DataSourceRole,
  DEFAULT_THRESHOLDS,
  FUNCTION_ID,
  type MaterializedViews,
  type ModelSnapshot,
} from '@lobechat/utils';
import { TRPCError } from '@trpc/server';

import {
  BusinessFunctionResultRowModel,
  BusinessFunctionRunModel,
} from '@/database/models/businessFunction';
import type {
  BusinessFunctionRunConfig,
  BusinessFunctionRunItem,
} from '@/database/schemas/businessFunction';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import {
  ALLOWED_EXTENSIONS,
  assertRoleFile,
  EXPORT_S3_KEY,
  guessRoleFromFileName,
  INPUT_S3_KEY,
  MAX_INPUT_FILE_BYTES,
  RUN_S3_PREFIX,
} from './constants';
import { buildWorkbookBuffer } from './exportWorkbook';
import {
  stepAiBatches,
  stepMaterializeAndPersist,
  stepParseAndAggregate,
  stepProductProfile,
} from './pipeline';

export class AmazonOldProductKeywordService {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId: string;
  private runModel: BusinessFunctionRunModel;
  private rowModel: BusinessFunctionResultRowModel;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string, workspaceId: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.runModel = new BusinessFunctionRunModel(db, userId, workspaceId);
    this.rowModel = new BusinessFunctionResultRowModel(db, userId, workspaceId);
    this.fileService = new FileService(db, userId, workspaceId);
  }

  createDraft = async (input: {
    mainAsin: string;
    categoryName: string;
    priceUsd: number;
    model: ModelSnapshot;
    thresholds?: Partial<AnalysisThresholds>;
  }) => {
    const mainAsin = input.mainAsin.trim().toUpperCase();
    if (!/^B0[A-Z0-9]{8}$/.test(mainAsin)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_MAIN_ASIN' });
    }
    const active = await this.runModel.findActiveByAsin(FUNCTION_ID, mainAsin);
    if (active) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `ACTIVE_RUN_EXISTS:${active.id}`,
      });
    }

    const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
    const config: BusinessFunctionRunConfig = {
      marketplace: 'US',
      mainAsin,
      categoryName: input.categoryName.trim(),
      priceUsd: input.priceUsd,
      thresholds,
      model: input.model,
      sourceManifest: {},
    };

    return this.runModel.create({
      functionType: FUNCTION_ID,
      mainAsin,
      categoryName: config.categoryName,
      status: 'draft',
      stage: 'draft',
      config,
      progress: { stage: 'draft', percent: 0 },
      exportInfo: { status: 'idle' },
    });
  };

  createUploadUrl = async (input: {
    runId: string;
    role: DataSourceRole;
    fileName: string;
    contentType?: string;
  }) => {
    const run = await this.requireRun(input.runId, ['draft', 'failed']);
    try {
      assertRoleFile(input.role, input.fileName, input.contentType);
    } catch (e) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: e instanceof Error ? e.message : 'INVALID_FILE',
      });
    }
    const ext = input.fileName.includes('.')
      ? `.${input.fileName.split('.').pop()!.toLowerCase()}`
      : '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_FILE_EXTENSION' });
    }
    const s3Key = INPUT_S3_KEY(this.workspaceId, run.id, input.role, input.fileName);
    const url = await this.fileService.createPreSignedUrl(s3Key);
    return {
      s3Key,
      url,
      headers: { 'Content-Type': input.contentType || 'application/octet-stream' },
    };
  };

  confirmUpload = async (input: {
    runId: string;
    role: DataSourceRole;
    fileName: string;
    s3Key: string;
  }) => {
    const run = await this.requireRun(input.runId, ['draft', 'failed', 'auditing']);
    const expectedPrefix = `${RUN_S3_PREFIX(this.workspaceId, run.id)}/inputs/`;
    if (!input.s3Key.startsWith(expectedPrefix)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'INVALID_S3_KEY' });
    }

    let meta: { contentLength: number; contentType?: string };
    try {
      meta = await this.fileService.getFileMetadata(input.s3Key);
    } catch {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'FILE_NOT_FOUND_IN_S3' });
    }
    if (meta.contentLength > MAX_INPUT_FILE_BYTES) {
      await this.fileService.deleteFile(input.s3Key).catch(() => undefined);
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'FILE_TOO_LARGE' });
    }
    try {
      assertRoleFile(input.role, input.fileName, meta.contentType);
    } catch (e) {
      await this.fileService.deleteFile(input.s3Key).catch(() => undefined);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: e instanceof Error ? e.message : 'INVALID_FILE',
      });
    }

    const config = { ...(run.config as BusinessFunctionRunConfig) };
    const prev = config.sourceManifest?.[input.role];
    if (prev?.s3Key && prev.s3Key !== input.s3Key) {
      await this.fileService.deleteFile(prev.s3Key).catch(() => undefined);
    }
    config.sourceManifest = {
      ...config.sourceManifest,
      [input.role]: {
        role: input.role,
        fileName: input.fileName,
        s3Key: input.s3Key,
        size: meta.contentLength,
        contentType: meta.contentType,
      },
    };

    return this.runModel.update(run.id, { config });
  };

  guessRoles = (fileNames: string[]) =>
    fileNames.map((fileName) => ({
      fileName,
      role: guessRoleFromFileName(fileName),
    }));

  auditInputs = async (runId: string) => {
    const run = await this.requireRun(runId, ['draft', 'failed', 'auditing']);
    await this.runModel.update(runId, {
      status: 'auditing',
      stage: 'audit_inputs',
      progress: { stage: 'audit_inputs', percent: 5, message: '审计输入文件' },
    });

    const config = run.config as BusinessFunctionRunConfig;
    const manifest = config.sourceManifest ?? {};
    const hasHtml = !!manifest.product_html;
    const hasHist = !!manifest.historical_terms;
    const hasSp = !!manifest.sp_search_terms_daily;
    if (!hasHtml || (!hasHist && !hasSp)) {
      await this.runModel.update(runId, {
        status: 'draft',
        stage: 'draft',
        progress: { stage: 'draft', percent: 0, message: '最低输入不足' },
      });
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'MIN_INPUTS_REQUIRED:product_html + (historical_terms|sp_search_terms_daily)',
      });
    }

    const notes: DataSourceNote[] = [];
    const missing: DataSourceRole[] = [];
    const parseErrors: string[] = [];
    let estimatedKeywords = 0;

    for (const role of DATA_SOURCE_ROLES) {
      const ref = manifest[role];
      if (!ref) {
        missing.push(role);
        notes.push({
          file: '—',
          role,
          missing: true,
          usage: '未提供',
          notes: '对应视图将标注受限',
        });
        continue;
      }

      try {
        const bytes = await this.fileService.getFileByteArray(ref.s3Key);
        const audit = await this.auditSourceFile(role, ref.fileName, bytes);
        if (audit.keywordEstimate) estimatedKeywords += audit.keywordEstimate;
        // enrich manifest entry
        config.sourceManifest = {
          ...config.sourceManifest,
          [role]: {
            ...ref,
            sheetNames: audit.sheetNames,
            dateRange: audit.dateRange,
            rawRowCount: audit.rawRowCount,
            includedRowCount: audit.includedRowCount,
            notes: audit.notes,
          },
        };
        notes.push({
          file: ref.fileName,
          role,
          rangeOrGranularity: audit.dateRange
            ? `${audit.dateRange.start ?? '?'}–${audit.dateRange.end ?? '?'}`
            : audit.sheetNames?.join(', '),
          usage: role,
          quality: `原始${audit.rawRowCount ?? 0}/纳入${audit.includedRowCount ?? 0}`,
          notes: audit.notes?.join('; ') || `size=${ref.size}`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        parseErrors.push(`${role}: ${msg}`);
        notes.push({
          file: ref.fileName,
          role,
          usage: role,
          notes: `解析失败: ${msg}`,
        });
      }
    }

    if (parseErrors.length > 0) {
      await this.runModel.update(runId, {
        status: 'draft',
        stage: 'draft',
        config,
        progress: { stage: 'draft', percent: 0, message: '审计发现不可解析文件' },
      });
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `AUDIT_PARSE_FAILED:${parseErrors.join(' | ')}`,
      });
    }

    // conservative floor so UI never shows 0 batches when files exist
    if (estimatedKeywords < 50 && (hasHist || hasSp)) estimatedKeywords = 50;
    const estimatedBatches = Math.max(1, Math.ceil(estimatedKeywords / 40));
    config.auditReport = { missing, notes, estimatedBatches, estimatedKeywords };

    const updated = await this.runModel.update(runId, {
      status: 'draft',
      stage: 'draft',
      config,
      progress: { stage: 'draft', percent: 10, message: '审计完成' },
    });
    return { run: updated, missing, notes, estimatedBatches, estimatedKeywords };
  };

  private auditSourceFile = async (
    role: DataSourceRole,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<{
    sheetNames?: string[];
    dateRange?: { start?: string; end?: string };
    rawRowCount?: number;
    includedRowCount?: number;
    keywordEstimate?: number;
    notes?: string[];
  }> => {
    if (role === 'product_html') {
      const text = new TextDecoder('utf-8').decode(bytes);
      if (text.length < 50 && !/<html/i.test(text)) {
        throw new Error('HTML_TOO_SHORT_OR_INVALID');
      }
      return {
        rawRowCount: 1,
        includedRowCount: 1,
        notes: ['HTML 语义上下文可用'],
      };
    }

    const { readWorkbook } = await import('./parseSources');
    const wb = readWorkbook(bytes);
    if (!wb.SheetNames?.length) throw new Error('NO_SHEETS');
    const XLSX = await import('xlsx');
    let raw = 0;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name]!, { defval: '' });
      raw += rows.length;
    }
    if (raw === 0) throw new Error('EMPTY_WORKBOOK');

    // light header sniff on first sheet
    const first = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!, {
      defval: '',
    });
    const headers = first[0] ? Object.keys(first[0]).join('|').toLowerCase() : '';
    const notes: string[] = [`sheets=${wb.SheetNames.length}`];

    if (
      (role === 'sp_search_terms_daily' || role === 'sb_search_terms_daily') &&
      !/搜索|search|query|关键词|keyword/.test(headers) &&
      first.length > 0
    ) {
      // multi-sheet reports may put headers differently — warn not fail
      notes.push('表头未直接命中搜索词列，管线将按多表头候选匹配');
    }

    return {
      sheetNames: wb.SheetNames,
      rawRowCount: raw,
      includedRowCount: raw,
      keywordEstimate: Math.min(raw, 50_000),
      notes,
    };
  };

  start = async (runId: string) => {
    const run = await this.requireRun(runId, ['draft', 'failed']);
    const config = run.config as BusinessFunctionRunConfig;
    const manifest = config.sourceManifest ?? {};
    const hasHtml = !!manifest.product_html;
    const hasHist = !!manifest.historical_terms;
    const hasSp = !!manifest.sp_search_terms_daily;
    if (!hasHtml || (!hasHist && !hasSp)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'MIN_INPUTS_REQUIRED:product_html + (historical_terms|sp_search_terms_daily)',
      });
    }
    const active = await this.runModel.findActiveByAsin(FUNCTION_ID, config.mainAsin, runId);
    if (active) {
      throw new TRPCError({ code: 'CONFLICT', message: `ACTIVE_RUN_EXISTS:${active.id}` });
    }

    // resume from last failed stage when possible
    const resumeStage =
      run.status === 'failed' && run.stage && run.stage !== 'done' ? run.stage : 'parse_sources';

    const updated = await this.runModel.update(runId, {
      status: 'queued',
      stage: resumeStage,
      startedAt: new Date(),
      error: null as any,
      cancelRequested: 0,
      progress: {
        stage: resumeStage,
        percent: 12,
        message: resumeStage === 'parse_sources' ? '已入队' : `续跑自 ${resumeStage}`,
      },
    });
    return updated;
  };

  /** Roll back queued after QStash dispatch failure so user can re-start. */
  markDispatchFailed = async (runId: string, message: string) => {
    const run = await this.runModel.findById(runId);
    if (!run || run.status !== 'queued') return run;
    const rollbackStatus = run.error || run.stage !== 'parse_sources' ? 'failed' : 'draft';
    return this.runModel.update(runId, {
      status: rollbackStatus as any,
      error: {
        code: 'WORKFLOW_DISPATCH_FAILED',
        message,
        retryable: true,
        stage: run.stage,
      },
      progress: {
        stage: run.stage,
        percent: run.progress?.percent ?? 0,
        message: `入队失败：${message}`,
      },
    });
  };

  /**
   * Conditionally release pending export claim only.
   * Returns the updated run, or undefined if status already left pending.
   */
  releaseExportClaim = async (runId: string, message: string) => {
    return this.runModel.releaseExportClaim(runId, message);
  };

  listRuns = async (limit = 30, offset = 0) => {
    const [rows, total] = await Promise.all([
      this.runModel.query({ functionType: FUNCTION_ID, limit, offset }),
      this.runModel.count({ functionType: FUNCTION_ID }),
    ]);
    return { rows, total };
  };

  getRun = async (runId: string) => this.requireRun(runId);

  listResultRows = async (params: {
    runId: string;
    viewId: string;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'orders' | 'spend' | 'score' | 'rank' | 'createdAt';
    sortDir?: 'asc' | 'desc';
  }) => {
    await this.requireRun(params.runId);
    return this.rowModel.query(params);
  };

  cancel = async (runId: string) => {
    const run = await this.requireRun(runId, ['queued', 'running', 'auditing', 'exporting']);
    await this.runModel.requestCancel(runId);
    if (run.status === 'queued') {
      return this.runModel.update(runId, {
        status: 'canceled',
        stage: 'done',
        finishedAt: new Date(),
        progress: { stage: 'done', percent: 100, message: '已取消' },
      });
    }
    return this.runModel.update(runId, {
      progress: {
        ...(run.progress as any),
        message: '取消请求已提交，将在当前阶段结束后停止',
      },
    });
  };

  retry = async (runId: string) => {
    const run = await this.requireRun(runId, ['failed', 'canceled']);
    const config = run.config as BusinessFunctionRunConfig;
    if (config.mainAsin) {
      const active = await this.runModel.findActiveByAsin(FUNCTION_ID, config.mainAsin, runId);
      if (active) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `ACTIVE_RUN_EXISTS:${active.id}`,
        });
      }
    }
    return this.runModel.update(runId, {
      status: 'queued',
      error: null as any,
      cancelRequested: 0,
      startedAt: new Date(),
      finishedAt: null as any,
      progress: {
        stage: (run.stage as string) || 'parse_sources',
        percent: 12,
        message: '续跑已入队',
      },
    });
  };

  delete = async (runId: string) => {
    const run = await this.requireRun(runId);
    if (['queued', 'running', 'exporting', 'auditing'].includes(run.status)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'CANNOT_DELETE_ACTIVE_RUN' });
    }
    const prefix = RUN_S3_PREFIX(this.workspaceId, runId);
    await this.fileService.deleteByPrefix(prefix).catch(() => undefined);
    await this.rowModel.deleteByRunId(runId);
    await this.runModel.delete(runId);
    return { success: true as const };
  };

  /**
   * Request export. Returns { run, claimed } where claimed=true only if this
   * caller atomically moved export_info to pending and should trigger the workflow.
   */
  requestExport = async (runId: string) => {
    const run = await this.requireRun(runId, ['succeeded', 'exporting']);
    if (run.exportInfo?.status === 'succeeded' && run.exportInfo.s3Key) {
      return { run, claimed: false as const };
    }
    if (run.exportInfo?.status === 'pending' || run.exportInfo?.status === 'running') {
      return { run, claimed: false as const };
    }
    const claimed = await this.runModel.claimExport(runId);
    if (claimed) return { run: claimed, claimed: true as const };
    // lost race — re-read current state
    const current = await this.requireRun(runId);
    return { run: current, claimed: false as const };
  };

  getExportUrl = async (runId: string) => {
    const run = await this.requireRun(runId);
    if (run.exportInfo?.status !== 'succeeded' || !run.exportInfo.s3Key) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'EXPORT_NOT_READY' });
    }
    const url = await this.fileService.createPreSignedUrlForPreview(run.exportInfo.s3Key, 3600);
    return {
      url,
      fileName: run.exportInfo.fileName,
      size: run.exportInfo.size,
    };
  };

  // ─── Workflow entry (server-side, unscoped update) ─────────────────────

  /**
   * Sequential staged pipeline (also used if a single-step caller is needed).
   * Each step is resume-aware and may skip when its outputs already exist.
   */
  executePipeline = async (runId: string) => {
    const ctx = {
      db: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
      runId,
    };
    const run = await this.runModel.findByIdUnscoped(runId);
    if (!run) throw new Error('RUN_NOT_FOUND');
    if (run.cancelRequested) {
      await this.runModel.updateById(runId, {
        status: 'canceled',
        finishedAt: new Date(),
        progress: { stage: 'done', percent: 100, message: '已取消' },
      });
      return { canceled: true };
    }

    const r1 = await stepParseAndAggregate(ctx);
    if ((r1 as any).canceled) return r1;

    const r2 = await stepProductProfile(ctx);
    if ((r2 as any).canceled) return r2;

    const r3 = await stepAiBatches(ctx);
    if ((r3 as any).canceled || (r3 as any).failed) return r3;

    return stepMaterializeAndPersist(ctx);
  };

  /** Individual steps exposed for multi-step Upstash workflow. */
  stepParseAndAggregate = (runId: string) =>
    stepParseAndAggregate({
      db: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
      runId,
    });
  stepProductProfile = (runId: string) =>
    stepProductProfile({
      db: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
      runId,
    });
  stepAiBatches = (runId: string) =>
    stepAiBatches({
      db: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
      runId,
    });
  stepMaterializeAndPersist = (runId: string) =>
    stepMaterializeAndPersist({
      db: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
      runId,
    });

  executeExport = async (runId: string) => {
    const run = await this.runModel.findByIdUnscoped(runId);
    if (!run) throw new Error('RUN_NOT_FOUND');
    const config = run.config as BusinessFunctionRunConfig;

    await this.runModel.updateById(runId, {
      exportInfo: { status: 'running' },
      status: 'exporting',
      progress: { stage: 'export', percent: 95, message: '生成Excel' },
    });

    try {
      const views = await this.loadViewsFromDb(runId);
      const { buffer, fileName } = await buildWorkbookBuffer(views, config.categoryName);
      const s3Key = EXPORT_S3_KEY(this.workspaceId, runId, fileName);
      await this.fileService.uploadBuffer(
        s3Key,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      await this.runModel.updateById(runId, {
        status: 'succeeded',
        stage: 'done',
        exportInfo: {
          status: 'succeeded',
          s3Key,
          fileName,
          size: buffer.length,
          generatedAt: new Date().toISOString(),
        },
        progress: { stage: 'done', percent: 100, message: '导出完成' },
      });
      return { s3Key, fileName, size: buffer.length };
    } catch (e) {
      await this.runModel.updateById(runId, {
        status: 'succeeded',
        exportInfo: {
          status: 'failed',
          error: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }
  };

  private loadViewsFromDb = async (runId: string): Promise<MaterializedViews> => {
    const load = async (viewId: string) => {
      const rows = await this.rowModel.listAllForView(runId, viewId);
      return rows.map((r) => r.data);
    };

    const overviewRows = await load('overview');
    return {
      overview: (overviewRows[0] as any) ?? {},
      high_win: (await load('high_win')) as any,
      new_opportunity: (await load('new_opportunity')) as any,
      low_efficiency: (await load('low_efficiency')) as any,
      history_sleep: (await load('history_sleep')) as any,
      competitor_gap: (await load('competitor_gap')) as any,
      asin_negative: (await load('asin_negative')) as any,
      full_lexicon: (await load('full_lexicon')) as any,
      brand_ads: (await load('brand_ads')) as any,
      sp_targeting: (await load('sp_targeting')) as any,
      daily_trend: (await load('daily_trend')) as any,
      scoring_rules: (await load('scoring_rules')) as any,
      data_sources: (await load('data_sources')) as any,
    };
  };

  private requireRun = async (
    runId: string,
    statuses?: string[],
  ): Promise<BusinessFunctionRunItem> => {
    const run = await this.runModel.findById(runId);
    if (!run || run.functionType !== FUNCTION_ID) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'RUN_NOT_FOUND' });
    }
    if (statuses && !statuses.includes(run.status)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `INVALID_STATUS:${run.status}`,
      });
    }
    return run;
  };
}
