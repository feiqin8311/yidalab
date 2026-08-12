/**
 * Close the trusted-delivery loop for model-tool dingpan uploads.
 * Called after tool messages are persisted (ServerMessageTransport).
 * Never trusts assistant prose — only tool content / pluginState.
 */

import { parseTrustedDingpanPreviewUrl } from '@lobechat/agent-runtime';
import { createNanoId } from '@lobechat/database';
import { dingpanDeliveryDedupeKey } from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DeliveryAttemptModel } from '@/database/models/deliveryAttempt';
import type { LobeChatDatabase } from '@/database/type';

import { recordDeliveryMetric } from './metrics';

const parsePayload = (content: unknown): Record<string, unknown> | null => {
  if (typeof content !== 'string' || !content.trim()) return null;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
};

const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
};

export type RecordModelToolDingpanOutcomeResult = {
  deliveryAttemptId?: string;
};

export async function recordModelToolDingpanOutcome(params: {
  content?: unknown;
  db: LobeChatDatabase;
  metadata?: Record<string, unknown> | null;
  /** Original tool arguments for redrive payload persistence. */
  pluginArguments?: string | Record<string, unknown> | null;
  plugin?: { apiName?: string; identifier?: string } | null;
  pluginState?: Record<string, unknown> | null;
  userId: string;
  workspaceId?: string | null;
}): Promise<RecordModelToolDingpanOutcomeResult> {
  const identifier = params.plugin?.identifier;
  const apiName = params.plugin?.apiName;
  if (identifier !== 'lobe-dingpan') return {};
  if (apiName !== 'uploadHtmlToDingpan' && apiName !== 'uploadToDingpan') return {};

  const operationId = String(params.metadata?.operationId ?? '').trim();
  if (!operationId) return {};

  const body = parsePayload(params.content) ?? {};
  const state = params.pluginState ?? {};
  const previewRaw = String(state.previewUrl ?? body.preview_url ?? body.previewUrl ?? '').trim();
  const trusted = parseTrustedDingpanPreviewUrl(previewRaw);
  const fileId =
    trusted?.fileId ||
    String(state.fileId ?? body.file_id ?? body.fileId ?? '').trim() ||
    undefined;
  const spaceId =
    trusted?.spaceId ||
    String(state.spaceId ?? body.space_id ?? body.spaceId ?? '').trim() ||
    undefined;
  const explicitFailure = state.success === false || body.success === false;
  const success = !explicitFailure && Boolean(trusted);

  let argsObj: Record<string, unknown> = {};
  if (typeof params.pluginArguments === 'string' && params.pluginArguments.trim()) {
    try {
      const p = JSON.parse(params.pluginArguments) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) argsObj = p as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  } else if (params.pluginArguments && typeof params.pluginArguments === 'object') {
    argsObj = params.pluginArguments as Record<string, unknown>;
  }

  const redrivePayload = {
    apiName,
    asin: str(argsObj.asin),
    documentId: str(argsObj.documentId),
    filePath: str(argsObj.filePath),
    folderId: str(argsObj.folderId),
    folderLink: str(argsObj.folderLink),
    html: str(argsObj.html),
    keyword: str(argsObj.keyword),
    productName: str(argsObj.productName),
    site: str(argsObj.site),
    spaceId: str(argsObj.spaceId) || spaceId,
    taskType: str(argsObj.taskType),
    title: str(argsObj.title),
    uploadName: str(argsObj.uploadName),
    userName: str(argsObj.userName),
  };

  const deliveryModel = new DeliveryAttemptModel(
    params.db,
    params.userId,
    params.workspaceId ?? undefined,
  );
  const opModel = new AgentOperationModel(
    params.db,
    params.userId,
    params.workspaceId ?? undefined,
  );
  const dedupeKey = dingpanDeliveryDedupeKey(operationId);

  try {
    const attempt = await deliveryModel.enqueue({
      artifactHash: 'report',
      dedupeKey,
      deliveryType: 'dingpan-report',
      metadata: {
        apiName,
        payload: redrivePayload,
        source: 'model-tool',
      },
      operationId,
    });
    recordDeliveryMetric('enqueue', 1, { source: 'model-tool', operationId });

    if (attempt.status === 'succeeded' && attempt.verificationStatus === 'verified') {
      if (success && trusted) {
        await opModel.recordOutcome(operationId, {
          outcomeErrorCode: null,
          outcomePreviewUrl: trusted.previewUrl,
          outcomeRetryable: false,
          outcomeStatus: 'verified',
          outcomeType: 'dingpan',
          outcomeVerifiedAt: new Date(),
        });
      }
      return { deliveryAttemptId: attempt.id };
    }

    const claimToken = createNanoId(16)();
    const claimed = await deliveryModel.tryClaim(attempt.id, {
      claimToken,
      claimedBy: 'model-tool',
      leaseMs: 60_000,
    });
    if (!claimed) return { deliveryAttemptId: attempt.id };

    if (success && trusted) {
      const done = await deliveryModel.markSucceeded(claimed.id, {
        claimToken,
        fileId,
        metadata: {
          ...(typeof claimed.metadata === 'object' && claimed.metadata ? claimed.metadata : {}),
          apiName,
          payload: redrivePayload,
          source: 'model-tool',
        },
        previewUrl: trusted.previewUrl,
        spaceId,
        verificationStatus: 'verified',
      });
      if (!done) return { deliveryAttemptId: claimed.id };
      await opModel.recordOutcome(operationId, {
        outcomeErrorCode: null,
        outcomePreviewUrl: trusted.previewUrl,
        outcomeRetryable: false,
        outcomeStatus: 'verified',
        outcomeType: 'dingpan',
        outcomeVerifiedAt: new Date(),
      });
      recordDeliveryMetric('succeeded', 1, {
        source: 'model-tool',
        operationId,
        deliveryAttemptId: claimed.id,
      });
      return { deliveryAttemptId: claimed.id };
    }

    const err =
      String(body.error ?? body.message ?? state.error ?? '').trim() ||
      (typeof params.content === 'string' ? params.content.slice(0, 200) : 'upload failed');
    const failed = await deliveryModel.markFailed(claimed.id, {
      claimToken,
      errorCode: 'model_tool_dingpan_failed',
      errorMessage: err.slice(0, 500),
      metadata: {
        ...(typeof claimed.metadata === 'object' && claimed.metadata ? claimed.metadata : {}),
        apiName,
        payload: redrivePayload,
        source: 'model-tool',
      },
      nextAttemptAt: new Date(Date.now() + 15_000),
      retryable: true,
    });
    if (!failed) return { deliveryAttemptId: claimed.id };
    await opModel.recordOutcome(operationId, {
      outcomeErrorCode: 'model_tool_dingpan_failed',
      outcomeRetryable: true,
      outcomeStatus: 'failed',
      outcomeType: 'dingpan',
    });
    recordDeliveryMetric('failed', 1, {
      source: 'model-tool',
      operationId,
      errorCode: 'model_tool_dingpan_failed',
    });
    return { deliveryAttemptId: claimed.id };
  } catch (error) {
    console.error('[recordModelToolDingpanOutcome] non-fatal:', error);
    return {};
  }
}
