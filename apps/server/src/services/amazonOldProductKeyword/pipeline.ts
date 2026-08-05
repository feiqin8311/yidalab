/**
 * Staged pipeline steps — each is independently callable from Upstash workflow
 * and supports cancel + resume of AI batches from persisted config.
 */
import {
  DATA_SOURCE_ROLES,
  type DataSourceNote,
  type KeywordEvidence,
  type KeywordSemanticScore,
  normalizeKeywordKey,
  type ProductSemanticProfile,
} from '@lobechat/utils';
import debug from 'debug';

import {
  BusinessFunctionResultRowModel,
  BusinessFunctionRunModel,
} from '@/database/models/businessFunction';
import type { BusinessFunctionRunConfig } from '@/database/schemas/businessFunction';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { AmazonKwAiScoring } from './aiScoring';
import { materializeViews, toResultRowRecords } from './materialize';
import {
  extractHtmlText,
  mergeCurrentMetrics,
  mergeDaily,
  type ParsedSources,
  parseHistorical,
  parseImpressionShare,
  parseMultiAsin,
  parseSbSearchTerms,
  parseSpSearchTerms,
  parseSpTargeting,
  readWorkbook,
} from './parseSources';

const log = debug('lobe-server:amazon-kw-pipeline');

export type PipelineCtx = {
  db: LobeChatDatabase;
  userId: string;
  workspaceId: string;
  runId: string;
};

const runModel = (ctx: PipelineCtx) =>
  new BusinessFunctionRunModel(ctx.db, ctx.userId, ctx.workspaceId);
const rowModel = (ctx: PipelineCtx) =>
  new BusinessFunctionResultRowModel(ctx.db, ctx.userId, ctx.workspaceId);
const files = (ctx: PipelineCtx) => new FileService(ctx.db, ctx.userId, ctx.workspaceId);

const throwIfCanceled = async (ctx: PipelineCtx) => {
  if (await runModel(ctx).isCancelRequested(ctx.runId)) {
    await runModel(ctx).updateById(ctx.runId, {
      status: 'canceled',
      stage: 'done',
      finishedAt: new Date(),
      progress: { stage: 'done', percent: 100, message: '已取消' },
    });
    return true;
  }
  return false;
};

const getConfig = async (ctx: PipelineCtx) => {
  const run = await runModel(ctx).findByIdUnscoped(ctx.runId);
  if (!run) throw new Error('RUN_NOT_FOUND');
  return { run, config: run.config as BusinessFunctionRunConfig };
};

/** Persist intermediate keyword map + scores under run config / S3 JSON sidecar. */
const INTERMEDIATE_KEY = (workspaceId: string, runId: string) =>
  `business-functions/amazon-old-product-keyword-analysis/${workspaceId}/${runId}/state/parsed.json`;

const SCORES_KEY = (workspaceId: string, runId: string) =>
  `business-functions/amazon-old-product-keyword-analysis/${workspaceId}/${runId}/state/scores.json`;

export async function stepParseAndAggregate(ctx: PipelineCtx) {
  if (await throwIfCanceled(ctx)) return { canceled: true as const };
  const { run, config } = await getConfig(ctx);
  // Resume: skip re-parse when intermediate state already exists past parse
  const pastParse = [
    'ai_product_profile',
    'ai_keyword_batches',
    'ops_labels',
    'materialize_views',
    'persist',
  ].includes(run.stage);
  if (pastParse) {
    try {
      await files(ctx).getFileByteArray(INTERMEDIATE_KEY(ctx.workspaceId, ctx.runId));
      return { success: true as const, skipped: true, naturalCount: 0 };
    } catch {
      // fall through to re-parse
    }
  }
  await runModel(ctx).updateById(ctx.runId, {
    status: 'running',
    stage: 'parse_sources',
    progress: { stage: 'parse_sources', percent: 15, message: '解析数据源' },
  });

  const parsed = await parseAllSources(ctx, config);
  mergeCurrentMetrics(parsed.keywords);

  await runModel(ctx).updateById(ctx.runId, {
    stage: 'aggregate',
    progress: { stage: 'aggregate', percent: 25, message: '聚合渠道证据' },
  });

  // serialize Map
  const payload = {
    keywords: [...parsed.keywords.entries()],
    dailyTrend: parsed.dailyTrend,
    spTargeting: parsed.spTargeting,
    productHtmlText: parsed.productHtmlText,
    sourceStats: parsed.sourceStats,
    spOrderAudit: parsed.spOrderAudit,
  };
  await files(ctx).uploadBuffer(
    INTERMEDIATE_KEY(ctx.workspaceId, ctx.runId),
    Buffer.from(JSON.stringify(payload)),
    'application/json',
  );

  const naturalCount = [...parsed.keywords.values()].filter((k) => !k.isExactAsin).length;
  config.auditReport = {
    ...config.auditReport,
    estimatedKeywords: naturalCount,
    estimatedBatches: Math.ceil(naturalCount / 40),
  };
  await runModel(ctx).updateById(ctx.runId, {
    config,
    progress: {
      stage: 'aggregate',
      percent: 28,
      message: `已聚合 ${naturalCount} 个自然词`,
      keywordTotal: naturalCount,
    },
  });
  return { success: true as const, naturalCount };
}

export async function stepProductProfile(ctx: PipelineCtx) {
  if (await throwIfCanceled(ctx)) return { canceled: true as const };
  const { config } = await getConfig(ctx);
  if (config.productProfile) {
    return { success: true as const, skipped: true };
  }
  await runModel(ctx).updateById(ctx.runId, {
    stage: 'ai_product_profile',
    progress: { stage: 'ai_product_profile', percent: 30, message: '生成产品语义档案' },
  });

  const intermediate = await loadIntermediate(ctx);
  const scorer = new AmazonKwAiScoring(
    ctx.db,
    ctx.userId,
    ctx.workspaceId,
    config.model.provider,
    config.model.model,
    config.thresholds,
  );
  const profile = await scorer.buildProductProfile({
    mainAsin: config.mainAsin,
    categoryName: config.categoryName,
    htmlText:
      intermediate.productHtmlText || `主ASIN ${config.mainAsin} 品类 ${config.categoryName}`,
  });
  config.productProfile = profile as any;
  await runModel(ctx).updateById(ctx.runId, {
    config,
    progress: { stage: 'ai_product_profile', percent: 35, message: '产品档案完成' },
  });
  return { success: true as const };
}

export async function stepAiBatches(ctx: PipelineCtx) {
  if (await throwIfCanceled(ctx)) return { canceled: true as const };
  const { config } = await getConfig(ctx);
  const intermediate = await loadIntermediate(ctx);
  const profile = config.productProfile as ProductSemanticProfile;
  if (!profile) throw new Error('PRODUCT_PROFILE_MISSING');

  const naturalKeys = intermediate.keywords.filter(([, v]) => !v.isExactAsin).map(([k]) => k);
  const batches = AmazonKwAiScoring.chunkKeywords(naturalKeys);
  const existingScores = await loadScores(ctx);
  const doneSet = new Set(
    Object.keys(existingScores).filter((k) => existingScores[k]?.relevanceScore != null),
  );

  // resume: find first incomplete batch
  let startBatch = 0;
  for (let i = 0; i < batches.length; i++) {
    const complete = batches[i]!.every((kw) => doneSet.has(kw));
    if (!complete) {
      startBatch = i;
      break;
    }
    startBatch = i + 1;
  }

  config.aiBatchProgress = {
    done: startBatch,
    total: batches.length,
    failedBatches: config.aiBatchProgress?.failedBatches ?? [],
  };
  await runModel(ctx).updateById(ctx.runId, {
    stage: 'ai_keyword_batches',
    config,
    progress: {
      stage: 'ai_keyword_batches',
      percent: 35 + Math.round((startBatch / Math.max(batches.length, 1)) * 40),
      batchIndex: startBatch,
      batchTotal: batches.length,
      keywordTotal: naturalKeys.length,
      keywordDone: startBatch * 40,
      message: `语义评分续跑 ${startBatch}/${batches.length}`,
    },
  });

  const scorer = new AmazonKwAiScoring(
    ctx.db,
    ctx.userId,
    ctx.workspaceId,
    config.model.provider,
    config.model.model,
    config.thresholds,
  );

  const scores = { ...existingScores };

  for (let i = startBatch; i < batches.length; i++) {
    if (await throwIfCanceled(ctx)) return { canceled: true as const };
    // skip fully scored batches
    if (batches[i]!.every((kw) => scores[kw]?.relevanceScore != null)) {
      config.aiBatchProgress.done = i + 1;
      continue;
    }
    try {
      const batchScores = await scorer.scoreKeywordBatch(profile, batches[i]!);
      for (const s of batchScores) {
        scores[s.keywordKey || normalizeKeywordKey(s.keyword)] = s;
      }
      // clear failed flag for this batch if retry succeeded
      config.aiBatchProgress.failedBatches = (config.aiBatchProgress.failedBatches ?? []).filter(
        (b) => b !== i,
      );
    } catch (e) {
      log('batch %s failed: %s', i, e);
      config.aiBatchProgress.failedBatches = [
        ...new Set([...(config.aiBatchProgress.failedBatches ?? []), i]),
      ];
      // do not write fake scores — leave incomplete for resume
      await files(ctx).uploadBuffer(
        SCORES_KEY(ctx.workspaceId, ctx.runId),
        Buffer.from(JSON.stringify(scores)),
        'application/json',
      );
      config.aiBatchProgress.done = i;
      await runModel(ctx).updateById(ctx.runId, {
        status: 'failed',
        stage: 'ai_keyword_batches',
        finishedAt: new Date(),
        config,
        error: {
          code: 'AI_BATCH_FAILED',
          message: e instanceof Error ? e.message : String(e),
          stage: 'ai_keyword_batches',
          batchIndex: i,
          retryable: true,
        },
        progress: {
          stage: 'ai_keyword_batches',
          percent: 35 + Math.round((i / Math.max(batches.length, 1)) * 40),
          batchIndex: i,
          batchTotal: batches.length,
          message: `批次 ${i + 1} 失败，可续跑`,
        },
      });
      return { failed: true as const, batchIndex: i };
    }

    config.aiBatchProgress.done = i + 1;
    await files(ctx).uploadBuffer(
      SCORES_KEY(ctx.workspaceId, ctx.runId),
      Buffer.from(JSON.stringify(scores)),
      'application/json',
    );
    await runModel(ctx).updateById(ctx.runId, {
      config,
      progress: {
        stage: 'ai_keyword_batches',
        percent: 35 + Math.round(((i + 1) / Math.max(batches.length, 1)) * 40),
        batchIndex: i + 1,
        batchTotal: batches.length,
        keywordTotal: naturalKeys.length,
        keywordDone: Math.min(naturalKeys.length, (i + 1) * 40),
        message: `语义评分 ${i + 1}/${batches.length}`,
      },
    });
  }

  return { success: true as const };
}

export async function stepMaterializeAndPersist(ctx: PipelineCtx) {
  if (await throwIfCanceled(ctx)) return { canceled: true as const };
  const { config } = await getConfig(ctx);
  await runModel(ctx).updateById(ctx.runId, {
    stage: 'ops_labels',
    progress: { stage: 'ops_labels', percent: 80, message: '运营标签与视图' },
  });

  const intermediate = await loadIntermediate(ctx);
  const scoresObj = await loadScores(ctx);
  const keywords = new Map<string, KeywordEvidence>(intermediate.keywords as any);
  const scores = new Map<string, KeywordSemanticScore>();
  for (const [k, v] of Object.entries(scoresObj)) scores.set(k, v);

  // Missing scores = incomplete AI work — fail so resume can finish scoring.
  const missingScores: string[] = [];
  for (const [k, ev] of keywords) {
    if (ev.isExactAsin) continue;
    if (!scores.has(k)) missingScores.push(k);
  }
  if (missingScores.length > 0) {
    await runModel(ctx).updateById(ctx.runId, {
      status: 'failed',
      stage: 'ai_keyword_batches',
      finishedAt: new Date(),
      error: {
        code: 'AI_SCORES_INCOMPLETE',
        message: `缺少 ${missingScores.length} 个关键词语义分，请续跑`,
        stage: 'ai_keyword_batches',
        retryable: true,
        details: { sample: missingScores.slice(0, 20) },
      },
      progress: {
        stage: 'ai_keyword_batches',
        percent: 70,
        message: `缺少 ${missingScores.length} 个语义分`,
      },
    });
    return { failed: true as const, missing: missingScores.length };
  }

  const dataSourceNotes = buildDataSourceNotes(config, intermediate);
  const profile = (config.productProfile ?? {
    mainAsin: config.mainAsin,
    coreCategory: config.categoryName,
  }) as ProductSemanticProfile;

  const { views, summary } = materializeViews({
    keywords,
    scores,
    profile,
    thresholds: config.thresholds,
    priceUsd: config.priceUsd,
    mainAsin: config.mainAsin,
    dailyTrend: intermediate.dailyTrend,
    spTargeting: intermediate.spTargeting,
    dataSourceNotes,
    spOrderAudit: intermediate.spOrderAudit,
  });

  await runModel(ctx).updateById(ctx.runId, {
    stage: 'persist',
    progress: { stage: 'persist', percent: 90, message: '写入结果' },
  });

  await rowModel(ctx).deleteByRunIdUnscoped(ctx.runId);
  const records = toResultRowRecords(ctx.runId, views);
  await rowModel(ctx).upsertBatchAs(
    ctx.userId,
    ctx.workspaceId,
    records.map((r) => ({
      runId: ctx.runId,
      viewId: r.viewId,
      rowKey: r.rowKey,
      searchText: r.searchText,
      sortOrders: r.sortOrders,
      sortSpend: r.sortSpend,
      sortScore: r.sortScore,
      sortRank: r.sortRank,
      data: r.data,
    })),
  );

  await runModel(ctx).updateById(ctx.runId, {
    status: 'succeeded',
    stage: 'done',
    finishedAt: new Date(),
    summary: summary as any,
    config,
    progress: { stage: 'done', percent: 100, message: '完成' },
    exportInfo: { status: 'idle' },
    error: null as any,
  });
  return { success: true as const, summary };
}

// ─── helpers ─────────────────────────────────────────────────────────────

async function loadIntermediate(ctx: PipelineCtx) {
  const bytes = await files(ctx).getFileByteArray(INTERMEDIATE_KEY(ctx.workspaceId, ctx.runId));
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    keywords: [string, KeywordEvidence][];
    dailyTrend: ParsedSources['dailyTrend'];
    spTargeting: ParsedSources['spTargeting'];
    productHtmlText: string;
    sourceStats: ParsedSources['sourceStats'];
    spOrderAudit: ParsedSources['spOrderAudit'];
  };
}

async function loadScores(ctx: PipelineCtx): Promise<Record<string, KeywordSemanticScore>> {
  try {
    const bytes = await files(ctx).getFileByteArray(SCORES_KEY(ctx.workspaceId, ctx.runId));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

async function parseAllSources(
  ctx: PipelineCtx,
  config: BusinessFunctionRunConfig,
): Promise<ParsedSources> {
  const keywords = new Map<string, KeywordEvidence>();
  let dailyTrend: ParsedSources['dailyTrend'] = [];
  let spTargeting: ParsedSources['spTargeting'] = [];
  let productHtmlText = '';
  const sourceStats: ParsedSources['sourceStats'] = {};
  let spOrderAudit = { totalOrders: 0, naturalOrders: 0, asinOrders: 0 };
  const manifest = config.sourceManifest ?? {};
  const fs = files(ctx);

  const loadBytes = async (role: (typeof DATA_SOURCE_ROLES)[number]) => {
    const ref = manifest[role];
    if (!ref?.s3Key) return null;
    return fs.getFileByteArray(ref.s3Key);
  };

  if (manifest.product_html) {
    const bytes = await loadBytes('product_html');
    if (bytes) {
      productHtmlText = extractHtmlText(new TextDecoder('utf-8').decode(bytes));
      sourceStats.product_html = {
        sheetNames: [],
        rawRowCount: 1,
        includedRowCount: 1,
        notes: ['仅提取语义上下文'],
      };
    }
  }
  if (manifest.historical_terms) {
    const bytes = await loadBytes('historical_terms');
    if (bytes) {
      const stats = parseHistorical(readWorkbook(bytes), keywords);
      sourceStats.historical_terms = { ...stats, notes: [] };
    }
  }
  if (manifest.sp_search_terms_daily) {
    const bytes = await loadBytes('sp_search_terms_daily');
    if (bytes) {
      const stats = parseSpSearchTerms(readWorkbook(bytes), keywords);
      sourceStats.sp_search_terms_daily = {
        sheetNames: stats.sheetNames,
        rawRowCount: stats.rawRowCount,
        includedRowCount: stats.includedRowCount,
        dateRange: stats.dateRange,
        notes: stats.notes,
      };
      dailyTrend = mergeDaily(dailyTrend, stats.dailyTrend);
      spOrderAudit = stats.spOrderAudit;
    }
  }
  if (manifest.sb_search_terms_daily) {
    const bytes = await loadBytes('sb_search_terms_daily');
    if (bytes) {
      const stats = parseSbSearchTerms(readWorkbook(bytes), keywords);
      sourceStats.sb_search_terms_daily = {
        sheetNames: stats.sheetNames,
        rawRowCount: stats.rawRowCount,
        includedRowCount: stats.includedRowCount,
        dateRange: stats.dateRange,
        notes: [],
      };
      dailyTrend = mergeDaily(dailyTrend, stats.dailyTrend);
    }
  }
  if (manifest.sp_impression_share) {
    const bytes = await loadBytes('sp_impression_share');
    if (bytes) {
      sourceStats.sp_impression_share = {
        ...parseImpressionShare(readWorkbook(bytes), keywords),
        notes: [],
      };
    }
  }
  if (manifest.sp_targeting) {
    const bytes = await loadBytes('sp_targeting');
    if (bytes) {
      const stats = parseSpTargeting(readWorkbook(bytes));
      spTargeting = stats.rows;
      sourceStats.sp_targeting = {
        sheetNames: stats.sheetNames,
        rawRowCount: stats.rawRowCount,
        includedRowCount: stats.includedRowCount,
        notes: [],
      };
    }
  }
  if (manifest.multi_asin) {
    const bytes = await loadBytes('multi_asin');
    if (bytes) {
      sourceStats.multi_asin = {
        ...parseMultiAsin(readWorkbook(bytes), keywords, config.mainAsin),
        notes: [],
      };
    }
  }

  return { keywords, dailyTrend, spTargeting, productHtmlText, sourceStats, spOrderAudit };
}

function buildDataSourceNotes(
  config: BusinessFunctionRunConfig,
  parsed: {
    sourceStats: ParsedSources['sourceStats'];
  },
): DataSourceNote[] {
  const notes: DataSourceNote[] = [];
  for (const role of DATA_SOURCE_ROLES) {
    const ref = config.sourceManifest?.[role];
    const stats = parsed.sourceStats[role];
    if (!ref) {
      notes.push({ file: '—', role, missing: true, usage: '未提供', notes: '对应分析受限' });
      continue;
    }
    notes.push({
      file: ref.fileName,
      role,
      rangeOrGranularity: stats?.dateRange
        ? `${stats.dateRange.start ?? '?'}–${stats.dateRange.end ?? '?'}`
        : undefined,
      usage: role,
      quality: stats ? `原始${stats.rawRowCount}/纳入${stats.includedRowCount}` : undefined,
      notes: stats?.notes?.join('; '),
    });
  }
  return notes;
}
