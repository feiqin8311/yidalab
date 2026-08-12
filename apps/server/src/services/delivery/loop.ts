import {
  type DeliveryClaimMessage,
  extractDingpanUploadOutcomes,
  parseTrustedDingpanPreviewUrl,
} from '@lobechat/agent-runtime';
import {
  type DingpanDocumentBridge,
  DingpanExecutionRuntime,
} from '@lobechat/builtin-tool-dingpan/executionRuntime';
import { createNanoId } from '@lobechat/database';
import { dingpanDeliveryDedupeKey } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DeliveryAttemptModel } from '@/database/models/deliveryAttempt';
import { MessageModel } from '@/database/models/message';
import { getServerDB } from '@/database/server';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { DocumentService } from '@/server/services/document';
import { withVaultCredEnv } from '@/server/utils/withVaultCredEnv';

import { recordDeliveryMetric } from './metrics';

const log = debug('delivery:loop');

const DEFAULT_INTERVAL_MS = 30_000;
const LOCK_KEY = 'delivery:outbox:loop-lock';
const LOCK_TTL_SEC = 25;
const FIRST_DELAY_MS = 15_000;
const BATCH = 10;
const MAX_ATTEMPTS = 8;

let timer: NodeJS.Timeout | null = null;
let firstTimer: NodeJS.Timeout | null = null;
let started = false;

const intervalMs = (): number => {
  const raw = Number.parseInt(process.env.DELIVERY_DRAIN_INTERVAL_MS || '', 10);
  return Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_INTERVAL_MS;
};

const isEnabled = (): boolean => {
  if (process.env.DELIVERY_DRAIN === '0' || process.env.DELIVERY_DRAIN === 'off') return false;
  return Boolean(process.env.DATABASE_URL) && !process.env.VERCEL_ENV;
};

const tryLock = async (): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return true;
  const result = await redis.set(LOCK_KEY, String(Date.now()), 'EX', LOCK_TTL_SEC, 'NX');
  return result === 'OK';
};

const createDocumentBridge = (
  serverDB: Awaited<ReturnType<typeof getServerDB>>,
  userId: string,
  workspaceId?: string | null,
): DingpanDocumentBridge => {
  const documentService = new DocumentService(serverDB, userId, workspaceId ?? undefined);
  return {
    getDeliverableHtml: async (documentId) => {
      const doc = await documentService.getDocumentById(documentId);
      if (!doc?.content?.trim()) return null;
      return { content: doc.content, title: doc.title ?? doc.filename ?? undefined };
    },
    patchDingpanMetadata: async () => {
      /* redrive path does not need metadata patch */
    },
  };
};

export type RedrivePayload = {
  apiName?: string;
  asin?: string;
  documentId?: string;
  filePath?: string;
  folderId?: string;
  folderLink?: string;
  html?: string;
  keyword?: string;
  productName?: string;
  site?: string;
  spaceId?: string;
  taskType?: string;
  title?: string;
  uploadName?: string;
  userName?: string;
};

/** True when outbox should dead-letter immediately (no re-upload possible). */
export const isFilePathOnlyDingpanRedrive = (payload: RedrivePayload | null): boolean =>
  Boolean(payload?.apiName === 'uploadToDingpan' && !payload.html && !payload.documentId);

const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
};

/** Recover full upload args from tool plugin.arguments + attempt.metadata.payload. */
export const resolveRedrivePayload = (
  rows: Array<{ apiName?: string | null; arguments: string | null }>,
  metadata: unknown,
): RedrivePayload | null => {
  const fromMeta =
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    (metadata as { payload?: unknown }).payload &&
    typeof (metadata as { payload: unknown }).payload === 'object'
      ? ((metadata as { payload: Record<string, unknown> }).payload as Record<string, unknown>)
      : null;

  let fromArgs: Record<string, unknown> | null = null;
  let rowApiName: string | undefined;
  for (const row of rows) {
    if (row.apiName && !rowApiName) rowApiName = str(row.apiName);
    if (!row.arguments?.trim()) continue;
    try {
      const parsed = JSON.parse(row.arguments) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        fromArgs = parsed;
        if (row.apiName) rowApiName = str(row.apiName) || rowApiName;
        break;
      }
    } catch {
      /* ignore */
    }
  }

  // Prefer row.apiName (plugin column) over payload — approval-resume paths often
  // omit plugin on updateToolMessage so metadata defaults to uploadHtmlToDingpan.
  const metaApiName =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? str((metadata as { apiName?: unknown }).apiName)
      : undefined;

  const src = { ...fromMeta, ...fromArgs };
  const html = str(src.html);
  const documentId = str(src.documentId);
  const apiName =
    rowApiName ||
    str(src.apiName) ||
    str(fromMeta?.apiName) ||
    metaApiName ||
    'uploadHtmlToDingpan';
  const filePath = str(src.filePath);
  // Keep uploadToDingpan / filePath-only rows visible so drain can dead-letter them.
  if (!html && !documentId && apiName !== 'uploadToDingpan' && !filePath) return null;

  return {
    apiName,
    asin: str(src.asin),
    documentId,
    filePath,
    folderId: str(src.folderId),
    folderLink: str(src.folderLink),
    html,
    keyword: str(src.keyword),
    productName: str(src.productName),
    site: str(src.site),
    spaceId: str(src.spaceId),
    taskType: str(src.taskType) || 'Redrive报告',
    title: str(src.title) || str(src.uploadName),
    uploadName: str(src.uploadName),
    userName: str(src.userName),
  };
};

/**
 * Drain tick: re-verify existing tool uploads; if none, re-upload using full
 * original args (folderLink/spaceId/naming) from tool arguments or attempt metadata.
 */
const processAttempt = async (
  db: Awaited<ReturnType<typeof getServerDB>>,
  attempt: Awaited<ReturnType<typeof DeliveryAttemptModel.listDispatchable>>[number],
): Promise<'succeeded' | 'failed' | 'skipped'> => {
  if (attempt.attempt >= MAX_ATTEMPTS && attempt.status === 'failed') {
    const dead = await DeliveryAttemptModel.markDeadLetterGlobal(db, attempt.id, {
      errorCode: attempt.errorCode ?? 'max_attempts',
      errorMessage: attempt.errorMessage ?? 'max delivery attempts exceeded',
      expectedAttempt: attempt.attempt,
    });
    if (dead) {
      recordDeliveryMetric('dead_letter', 1, {
        deliveryAttemptId: attempt.id,
        operationId: attempt.operationId,
      });
    }
    return 'failed';
  }

  const claimToken = createNanoId(16)();
  const claimed = await DeliveryAttemptModel.tryClaimGlobal(db, attempt.id, {
    claimToken,
    claimedBy: 'delivery-drain',
    leaseMs: 120_000,
  });
  if (!claimed) return 'skipped';
  recordDeliveryMetric('claim', 1, {
    deliveryAttemptId: claimed.id,
    operationId: claimed.operationId,
  });

  try {
    const messageModel = new MessageModel(db, claimed.userId, claimed.workspaceId ?? undefined);
    const topicId =
      typeof claimed.metadata === 'object' && claimed.metadata && 'topicId' in claimed.metadata
        ? String((claimed.metadata as { topicId?: string }).topicId ?? '')
        : undefined;
    const rows = await messageModel.findDingpanUploadsByOperation({
      operationId: claimed.operationId,
      topicId: topicId || undefined,
    });
    const outcomes = extractDingpanUploadOutcomes(
      rows.map((row): DeliveryClaimMessage => ({
        content: row.content ?? '',
        plugin: {
          apiName: row.apiName ?? undefined,
          identifier: row.identifier ?? undefined,
        },
        role: 'tool',
      })),
    );
    const latest = [...outcomes].reverse().find((o) => o.success && o.previewUrl);
    const trustedExisting = latest?.previewUrl
      ? parseTrustedDingpanPreviewUrl(latest.previewUrl)
      : null;

    if (trustedExisting) {
      const done = await DeliveryAttemptModel.markSucceededGlobal(db, claimed.id, {
        claimToken,
        fileId: trustedExisting.fileId,
        previewUrl: trustedExisting.previewUrl,
        spaceId: trustedExisting.spaceId,
        verificationStatus: 'verified',
      });
      if (!done) return 'skipped';
      const opModel = new AgentOperationModel(db, claimed.userId, claimed.workspaceId ?? undefined);
      await opModel.recordOutcome(claimed.operationId, {
        outcomeErrorCode: null,
        outcomePreviewUrl: trustedExisting.previewUrl,
        outcomeRetryable: false,
        outcomeStatus: 'verified',
        outcomeType: 'dingpan',
        outcomeVerifiedAt: new Date(),
      });
      recordDeliveryMetric('succeeded', 1, {
        source: 'drain-verify',
        operationId: claimed.operationId,
        deliveryAttemptId: claimed.id,
      });
      return 'succeeded';
    }

    const payload = resolveRedrivePayload(rows, claimed.metadata);
    // uploadToDingpan (filePath) is not re-uploadable from outbox alone — need html/documentId.
    // apiName comes from message_plugins.apiName when present (approval-resume safe).
    if (isFilePathOnlyDingpanRedrive(payload)) {
      const failed = await DeliveryAttemptModel.markFailedGlobal(db, claimed.id, {
        claimToken,
        errorCode: 'drain_file_path_not_redrivable',
        errorMessage: 'uploadToDingpan filePath artifacts cannot be re-uploaded from outbox',
        nextAttemptAt: undefined,
        retryable: false,
      });
      if (failed) {
        recordDeliveryMetric('dead_letter', 1, {
          deliveryAttemptId: claimed.id,
          operationId: claimed.operationId,
        });
      }
      return 'failed';
    }

    if (payload?.html || payload?.documentId) {
      const bridge = createDocumentBridge(db, claimed.userId, claimed.workspaceId);
      const runtime = new DingpanExecutionRuntime({ documentBridge: bridge });
      const result = await withVaultCredEnv(claimed.userId, db, () =>
        runtime.uploadHtmlToDingpan({
          ...(payload.html ? { html: payload.html } : {}),
          ...(payload.documentId ? { documentId: payload.documentId } : {}),
          ...(payload.folderId ? { folderId: payload.folderId } : {}),
          ...(payload.folderLink ? { folderLink: payload.folderLink } : {}),
          ...(payload.spaceId ? { spaceId: payload.spaceId } : {}),
          ...(payload.asin ? { asin: payload.asin } : {}),
          ...(payload.site ? { site: payload.site } : {}),
          ...(payload.productName ? { productName: payload.productName } : {}),
          ...(payload.keyword ? { keyword: payload.keyword } : {}),
          ...(payload.userName ? { userName: payload.userName } : {}),
          ...(payload.uploadName ? { uploadName: payload.uploadName } : {}),
          taskType: payload.taskType || 'Redrive报告',
          title: payload.title || `Redrive_${claimed.operationId.slice(0, 8)}`,
          topicId: topicId || undefined,
        }),
      );

      if (result.success) {
        let previewUrl: string | undefined;
        let fileId: string | undefined;
        let spaceId: string | undefined;
        try {
          const body =
            typeof result.content === 'string'
              ? (JSON.parse(result.content) as Record<string, unknown>)
              : null;
          previewUrl = String(body?.preview_url ?? body?.previewUrl ?? '').trim() || undefined;
          fileId = String(body?.file_id ?? body?.fileId ?? '').trim() || undefined;
          spaceId = String(body?.space_id ?? body?.spaceId ?? '').trim() || undefined;
        } catch {
          /* ignore */
        }
        const trusted = previewUrl ? parseTrustedDingpanPreviewUrl(previewUrl) : null;
        if (trusted) {
          const done = await DeliveryAttemptModel.markSucceededGlobal(db, claimed.id, {
            claimToken,
            fileId: fileId || trusted.fileId,
            previewUrl: trusted.previewUrl,
            spaceId: spaceId || trusted.spaceId,
            verificationStatus: 'verified',
          });
          if (!done) return 'skipped';
          const opModel = new AgentOperationModel(
            db,
            claimed.userId,
            claimed.workspaceId ?? undefined,
          );
          await opModel.recordOutcome(claimed.operationId, {
            outcomeErrorCode: null,
            outcomePreviewUrl: trusted.previewUrl,
            outcomeRetryable: false,
            outcomeStatus: 'verified',
            outcomeType: 'dingpan',
            outcomeVerifiedAt: new Date(),
          });
          recordDeliveryMetric('succeeded', 1, {
            source: 'drain-reupload',
            operationId: claimed.operationId,
            deliveryAttemptId: claimed.id,
          });
          return 'succeeded';
        }
      }
    }

    const backoffMs = Math.min(300_000, 5_000 * 2 ** Math.min(claimed.attempt, 6));
    const retryable = claimed.attempt < MAX_ATTEMPTS;
    const failed = await DeliveryAttemptModel.markFailedGlobal(db, claimed.id, {
      claimToken,
      errorCode: payload ? 'drain_reupload_failed' : 'drain_no_artifact',
      errorMessage: payload
        ? 're-upload did not yield trusted preview_url'
        : 'no tool html/documentId artifact to re-upload',
      nextAttemptAt: new Date(Date.now() + backoffMs),
      retryable,
    });
    if (!failed) return 'skipped';
    recordDeliveryMetric('failed', 1, {
      source: 'drain',
      operationId: claimed.operationId,
      retryable: retryable ? 1 : 0,
    });
    if (!retryable) {
      recordDeliveryMetric('dead_letter', 1, {
        deliveryAttemptId: claimed.id,
        operationId: claimed.operationId,
      });
    }
    return 'failed';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await DeliveryAttemptModel.markFailedGlobal(db, claimed.id, {
      claimToken,
      errorCode: 'drain_exception',
      errorMessage: message.slice(0, 500),
      nextAttemptAt: new Date(Date.now() + 30_000),
      retryable: true,
    });
    if (!failed) return 'skipped';
    console.error('[delivery:loop] process failed:', error);
    return 'failed';
  }
};

const tick = async () => {
  try {
    const acquired = await tryLock();
    if (!acquired) {
      log('skip tick: lock held');
      return;
    }

    const db = await getServerDB();
    const batch = await DeliveryAttemptModel.listDispatchable(db, BATCH);
    recordDeliveryMetric('drain_batch', batch.length);

    if (batch[0]) {
      const ageMs = Date.now() - new Date(batch[0].createdAt).getTime();
      recordDeliveryMetric('pending_age_ms', ageMs, {
        deliveryAttemptId: batch[0].id,
        status: batch[0].status,
      });
    }

    let succeeded = 0;
    let failed = 0;
    for (const attempt of batch) {
      if (!attempt.dedupeKey.includes(attempt.operationId)) {
        log(
          'unexpected dedupeKey %s (want %s)',
          attempt.dedupeKey,
          dingpanDeliveryDedupeKey(attempt.operationId),
        );
      }
      const result = await processAttempt(db, attempt);
      if (result === 'succeeded') succeeded += 1;
      if (result === 'failed') failed += 1;
    }

    if (batch.length > 0) {
      log('tick batch=%d succeeded=%d failed=%d', batch.length, succeeded, failed);
    }
  } catch (error) {
    console.error('[delivery:loop] tick failed:', error);
  }
};

/** Idempotent resident worker for delivery_attempts outbox. */
export function startDeliveryDrainLoop(): void {
  if (started) return;
  if (!isEnabled()) {
    log('disabled (DELIVERY_DRAIN off / no DATABASE_URL / Vercel)');
    return;
  }

  started = true;
  const ms = intervalMs();
  console.info(`[delivery:loop] started — every ${ms}ms`);

  firstTimer = setTimeout(() => {
    void tick();
  }, FIRST_DELAY_MS);
  firstTimer.unref?.();

  timer = setInterval(() => {
    void tick();
  }, ms);
  timer.unref?.();
}

export function stopDeliveryDrainLoop(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
  started = false;
}
