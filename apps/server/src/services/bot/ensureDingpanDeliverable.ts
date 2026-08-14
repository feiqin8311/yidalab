/**
 * System-side dingpan delivery guarantee for bot completions.
 *
 * Product invariant: report-class bot answers must end with a real 钉盘
 * preview_url (or an explicit failure). Models may skip uploadHtmlToDingpan;
 * forceFinish used to strip all tools. This module uploads a deterministic
 * HTML wrap of the final reply when **this operation** has no successful
 * upload yet, and persists a message-level tool Artifact (arguments.html)
 * for Web preview.
 *
 * Isolation: only same operationId may be reused (idempotent). Never reuse
 * topic-level historical uploads.
 *
 * Trusted delivery: enqueue → claim → upload → verify preview_url shape →
 * mark succeeded on delivery_attempts + agent_operations.outcome_*.
 * Model prose never sets outcome verified.
 */

import {
  type DeliveryClaimMessage,
  extractDingpanUploadOutcomes,
  isTrustedDingpanPreviewUrl,
} from '@lobechat/agent-runtime';
import { DingpanApiName, DingpanIdentifier } from '@lobechat/builtin-tool-dingpan';
import {
  type DingpanDocumentBridge,
  DingpanExecutionRuntime,
} from '@lobechat/builtin-tool-dingpan/executionRuntime';
import { createNanoId } from '@lobechat/database';
import type { ChatToolPayload } from '@lobechat/types';
import { dingpanDeliveryDedupeKey } from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DeliveryAttemptModel } from '@/database/models/deliveryAttempt';
import { MessageModel } from '@/database/models/message';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { recordDeliveryMetric } from '@/server/services/delivery/metrics';
import { DocumentService } from '@/server/services/document';
import { withVaultCredEnv } from '@/server/utils/withVaultCredEnv';

import { shouldEnsureDingpanForBotReply, wrapBotReplyAsHtml } from './botDingpanDeliveryHeuristic';
import type { BotTurnContext } from './botTurnContext';

/** In-process coalescing for concurrent ensure calls on the same operation. */
const inFlightByKey = new Map<string, Promise<EnsureDingpanDeliverableResult>>();

const deliveryKey = (operationId: string) => dingpanDeliveryDedupeKey(operationId);

const createDocumentBridge = (
  serverDB: LobeChatDatabase,
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

    patchDingpanMetadata: async (documentId, meta) => {
      const doc = await documentService.getDocumentById(documentId);
      if (!doc) return;
      const prev =
        doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
          ? (doc.metadata as Record<string, unknown>)
          : {};
      await documentService.updateDocument(documentId, {
        metadata: {
          ...prev,
          deliverable: true,
          dingpan: {
            fileId: meta.fileId,
            name: meta.name,
            previewUrl: meta.previewUrl,
            uploadedAt: new Date().toISOString(),
          },
          source: prev.source ?? 'bot-system-dingpan',
        },
      });
    },
  };
};

const resolveUserDisplayName = async (
  serverDB: LobeChatDatabase,
  userId: string,
): Promise<string | undefined> => {
  try {
    const row = await UserModel.findById(serverDB, userId);
    const name =
      row?.username?.trim() || [row?.firstName, row?.lastName].filter(Boolean).join('').trim();
    return name || undefined;
  } catch {
    return undefined;
  }
};

const latestSuccessfulPreviewForOperation = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}): Promise<string | undefined> => {
  const deliveryModel = new DeliveryAttemptModel(
    params.db,
    params.userId,
    params.workspaceId ?? undefined,
  );
  const succeeded = await deliveryModel.findSuccessfulByOperation(
    params.operationId,
    'dingpan-report',
  );
  if (succeeded?.previewUrl && isTrustedDingpanPreviewUrl(succeeded.previewUrl)) {
    return succeeded.previewUrl;
  }

  const messageModel = new MessageModel(params.db, params.userId, params.workspaceId ?? undefined);
  const rows = await messageModel.findDingpanUploadsByOperation({
    operationId: params.operationId,
    topicId: params.topicId,
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
  return [...outcomes].reverse().find((o) => o.success && o.previewUrl)?.previewUrl;
};

const recordOutcomeVerified = async (params: {
  artifactId?: string;
  db: LobeChatDatabase;
  operationId: string;
  previewUrl: string;
  userId: string;
  workspaceId?: string | null;
}) => {
  try {
    const opModel = new AgentOperationModel(
      params.db,
      params.userId,
      params.workspaceId ?? undefined,
    );
    await opModel.recordOutcome(params.operationId, {
      outcomeArtifactId: params.artifactId ?? null,
      outcomeErrorCode: null,
      outcomePreviewUrl: params.previewUrl,
      outcomeRetryable: false,
      outcomeStatus: 'verified',
      outcomeType: 'dingpan',
      outcomeVerifiedAt: new Date(),
    });
  } catch (error) {
    console.error('[ensureDingpanDeliverable] recordOutcome non-fatal:', error);
  }
};

const recordOutcomeFailed = async (params: {
  db: LobeChatDatabase;
  errorCode?: string;
  operationId: string;
  retryable?: boolean;
  userId: string;
  workspaceId?: string | null;
}) => {
  try {
    const opModel = new AgentOperationModel(
      params.db,
      params.userId,
      params.workspaceId ?? undefined,
    );
    await opModel.recordOutcome(params.operationId, {
      outcomeErrorCode: params.errorCode ?? 'dingpan_delivery_failed',
      outcomeRetryable: params.retryable ?? true,
      outcomeStatus: 'failed',
      outcomeType: 'dingpan',
    });
  } catch (error) {
    console.error('[ensureDingpanDeliverable] recordOutcome failed non-fatal:', error);
  }
};

/**
 * Persist system fallback upload as a dual-form tool message so Web history can
 * preview HTML from arguments.html (same surface as model uploadHtmlToDingpan).
 * Prefers explicit assistantMessageId; falls back to spine only when missing.
 */
const persistBotDingpanToolMessage = async (params: {
  assistantMessageId?: string;
  db: LobeChatDatabase;
  deliveryAttemptId?: string;
  html: string;
  operationId: string;
  previewUrl: string;
  resultContent: string;
  resultState?: Record<string, unknown>;
  sourceMessageId?: string;
  title: string;
  topicId: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<void> => {
  const messageModel = new MessageModel(params.db, params.userId, params.workspaceId ?? undefined);
  let parentId = params.assistantMessageId;
  if (!parentId) {
    parentId = (await messageModel.getLastMainThreadSpineMessageId(params.topicId)) ?? undefined;
  }
  if (!parentId) return;

  const toolCallId = `call_bot_dingpan_${createNanoId(12)()}`;
  const toolPayload: ChatToolPayload = {
    apiName: DingpanApiName.uploadHtmlToDingpan,
    arguments: JSON.stringify({
      html: params.html,
      taskType: 'Bot报告',
      title: params.title,
    }),
    id: toolCallId,
    identifier: DingpanIdentifier,
    type: 'builtin',
  };

  await messageModel.create({
    content: params.resultContent,
    metadata: {
      deliveryType: 'dingpan-report',
      operationId: params.operationId,
      source: 'system-fallback',
      sourceMessageId: params.sourceMessageId,
      systemInjected: true,
    },
    parentId,
    plugin: toolPayload as any,
    pluginState: {
      ...(params.resultState ?? {
        name: params.title,
        previewUrl: params.previewUrl,
        success: true,
      }),
      ...(params.deliveryAttemptId ? { deliveryAttemptId: params.deliveryAttemptId } : {}),
    },
    role: 'tool',
    tool_call_id: toolCallId,
    topicId: params.topicId,
  });

  const parent = await messageModel.findById(parentId);
  const existingTools = (Array.isArray(parent?.tools) ? parent.tools : []) as ChatToolPayload[];
  await messageModel.update(parentId, {
    tools: [...existingTools, toolPayload],
  });
};

export type EnsureDingpanDeliverableResult = {
  previewUrl?: string;
  /** Whether this call performed a new upload */
  uploaded: boolean;
  error?: string;
  deliveryAttemptId?: string;
  verificationStatus?: 'verified' | 'failed' | 'unverified' | 'pending';
};

/**
 * If the bot reply looks report-class and this operation has no successful
 * dingpan upload, wrap the reply as HTML and upload via the same runtime as tools.
 */
export async function ensureDingpanDeliverable(params: {
  db: LobeChatDatabase;
  reply: string;
  /** @deprecated use turn.topicId — kept for call-site migration */
  topicId?: string | null;
  turn?: BotTurnContext;
  userId: string;
  workspaceId?: string | null;
}): Promise<EnsureDingpanDeliverableResult> {
  const { db, userId, workspaceId } = params;
  const reply = params.reply.trim();
  const topicId = params.turn?.topicId ?? params.topicId;
  const operationId = params.turn?.operationId;
  if (!reply || !topicId || !operationId) return { uploaded: false };
  if (!shouldEnsureDingpanForBotReply(reply)) return { uploaded: false };

  const key = deliveryKey(operationId);
  const existingInFlight = inFlightByKey.get(key);
  if (existingInFlight) return existingInFlight;

  const work = (async (): Promise<EnsureDingpanDeliverableResult> => {
    const deliveryModel = new DeliveryAttemptModel(db, userId, workspaceId ?? undefined);
    /** Only the token this invocation minted — never re-read claimToken from DB. */
    let heldClaimToken: string | undefined;
    let heldClaimId: string | undefined;

    try {
      // Durable outbox row (idempotent). Survives process restart unlike inFlightByKey.
      const attempt = await deliveryModel.enqueue({
        artifactHash: 'report',
        dedupeKey: key,
        deliveryType: 'dingpan-report',
        metadata: {
          source: 'ensureDingpanDeliverable',
          topicId,
          // Redrive payload filled after wrap; partial seed for topic scoping.
          payload: { apiName: 'uploadHtmlToDingpan', taskType: 'Bot报告' },
        },
        operationId,
        targetFolder: 'default',
      });
      recordDeliveryMetric('enqueue', 1, { source: 'ensure', operationId });

      if (attempt.status === 'succeeded' && attempt.previewUrl) {
        await recordOutcomeVerified({
          artifactId: attempt.artifactId ?? undefined,
          db,
          operationId,
          previewUrl: attempt.previewUrl,
          userId,
          workspaceId,
        });
        return {
          deliveryAttemptId: attempt.id,
          previewUrl: attempt.previewUrl,
          uploaded: false,
          verificationStatus: 'verified',
        };
      }

      const existing = await latestSuccessfulPreviewForOperation({
        db,
        operationId,
        topicId,
        userId,
        workspaceId,
      });
      if (existing) {
        // Tool path already uploaded — claim then close outbox without re-upload.
        // CAS must succeed (or outbox already succeeded) before writing outcome.
        const closeToken = createNanoId(16)();
        const closeClaim = await deliveryModel.tryClaim(attempt.id, {
          claimToken: closeToken,
          claimedBy: 'ensureDingpanDeliverable-close',
          leaseMs: 60_000,
        });
        if (!closeClaim) {
          const latest = await deliveryModel.findByDedupeKey(key);
          if (latest?.status === 'succeeded' && latest.previewUrl) {
            await recordOutcomeVerified({
              db,
              operationId,
              previewUrl: latest.previewUrl,
              userId,
              workspaceId,
            });
            return {
              deliveryAttemptId: latest.id,
              previewUrl: latest.previewUrl,
              uploaded: false,
              verificationStatus: 'verified',
            };
          }
          // Claim held by another worker — do not write outcome without CAS.
          return {
            deliveryAttemptId: attempt.id,
            error: 'delivery claim held by another worker',
            previewUrl: existing,
            uploaded: false,
            verificationStatus: 'pending',
          };
        }

        heldClaimToken = closeToken;
        heldClaimId = closeClaim.id;
        const closed = await deliveryModel.markSucceeded(closeClaim.id, {
          claimToken: closeToken,
          previewUrl: existing,
          verificationStatus: 'verified',
        });
        if (!closed) {
          return {
            deliveryAttemptId: attempt.id,
            error: 'delivery claim lost before success write',
            previewUrl: existing,
            uploaded: false,
            verificationStatus: 'pending',
          };
        }
        heldClaimToken = undefined;
        heldClaimId = undefined;
        await recordOutcomeVerified({
          db,
          operationId,
          previewUrl: existing,
          userId,
          workspaceId,
        });
        return {
          deliveryAttemptId: attempt.id,
          previewUrl: existing,
          uploaded: false,
          verificationStatus: 'verified',
        };
      }

      const claimToken = createNanoId(16)();
      const claimed = await deliveryModel.tryClaim(attempt.id, {
        claimToken,
        claimedBy: 'ensureDingpanDeliverable',
        leaseMs: 180_000,
      });
      if (!claimed) {
        // Another worker holds the claim — re-read after brief wait is out of scope;
        // surface pending so caller can still show non-success honestly.
        const latest = await deliveryModel.findByDedupeKey(key);
        if (latest?.status === 'succeeded' && latest.previewUrl) {
          return {
            deliveryAttemptId: latest.id,
            previewUrl: latest.previewUrl,
            uploaded: false,
            verificationStatus: 'verified',
          };
        }
        return {
          deliveryAttemptId: attempt.id,
          error: 'delivery claim held by another worker',
          uploaded: false,
          verificationStatus: 'pending',
        };
      }
      heldClaimToken = claimToken;
      heldClaimId = claimed.id;

      const userName = await resolveUserDisplayName(db, userId);
      const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const title = `Bot报告_${userName || 'YidaLab'}_${stamp}`;
      const html = await wrapBotReplyAsHtml(reply, title);

      const bridge = createDocumentBridge(db, userId, workspaceId);
      const runtime = new DingpanExecutionRuntime({ documentBridge: bridge });

      const result = await withVaultCredEnv(userId, db, () =>
        runtime.uploadHtmlToDingpan({
          html,
          taskType: 'Bot报告',
          title,
          topicId,
          userName,
        }),
      );

      if (!result.success) {
        const err =
          (typeof result.content === 'string' && result.content.slice(0, 200)) ||
          result.error?.message ||
          'upload failed';
        console.error('[ensureDingpanDeliverable] upload failed:', err);
        const backoffMs = Math.min(60_000, 2_000 * 2 ** Math.min(claimed.attempt, 5));
        const failed = await deliveryModel.markFailed(claimed.id, {
          claimToken,
          errorCode: 'dingpan_upload_failed',
          errorMessage: err,
          metadata: {
            payload: {
              apiName: 'uploadHtmlToDingpan',
              html,
              taskType: 'Bot报告',
              title,
              userName,
            },
            source: 'ensureDingpanDeliverable',
            topicId,
          },
          nextAttemptAt: new Date(Date.now() + backoffMs),
          retryable: true,
        });
        if (!failed) {
          return {
            deliveryAttemptId: claimed.id,
            error: 'delivery claim lost before failure write',
            uploaded: false,
            verificationStatus: 'pending',
          };
        }
        heldClaimToken = undefined;
        await recordOutcomeFailed({
          db,
          errorCode: 'dingpan_upload_failed',
          operationId,
          retryable: true,
          userId,
          workspaceId,
        });
        return {
          deliveryAttemptId: claimed.id,
          error: err,
          uploaded: false,
          verificationStatus: 'failed',
        };
      }

      let previewUrl: string | undefined;
      let fileId: string | undefined;
      let spaceId: string | undefined;
      try {
        const payload =
          typeof result.content === 'string'
            ? (JSON.parse(result.content) as Record<string, unknown>)
            : null;
        previewUrl = String(payload?.preview_url ?? payload?.previewUrl ?? '').trim() || undefined;
        fileId = String(payload?.file_id ?? payload?.fileId ?? '').trim() || undefined;
        spaceId = String(payload?.space_id ?? payload?.spaceId ?? '').trim() || undefined;
      } catch {
        /* ignore */
      }

      if (!previewUrl) {
        previewUrl = await latestSuccessfulPreviewForOperation({
          db,
          operationId,
          topicId,
          userId,
          workspaceId,
        });
      }

      if (!previewUrl || !isTrustedDingpanPreviewUrl(previewUrl)) {
        const err = 'upload succeeded but preview_url missing or untrusted';
        const failed = await deliveryModel.markFailed(claimed.id, {
          claimToken,
          errorCode: 'dingpan_preview_unverified',
          errorMessage: err,
          metadata: {
            payload: {
              apiName: 'uploadHtmlToDingpan',
              html,
              taskType: 'Bot报告',
              title,
              userName,
            },
            source: 'ensureDingpanDeliverable',
            topicId,
          },
          nextAttemptAt: new Date(Date.now() + 10_000),
          retryable: true,
        });
        if (!failed) {
          return {
            deliveryAttemptId: claimed.id,
            error: 'delivery claim lost before failure write',
            uploaded: false,
            verificationStatus: 'pending',
          };
        }
        heldClaimToken = undefined;
        await recordOutcomeFailed({
          db,
          errorCode: 'dingpan_preview_unverified',
          operationId,
          retryable: true,
          userId,
          workspaceId,
        });
        return {
          deliveryAttemptId: claimed.id,
          error: err,
          uploaded: false,
          verificationStatus: 'failed',
        };
      }

      try {
        await persistBotDingpanToolMessage({
          assistantMessageId: params.turn?.assistantMessageId,
          db,
          deliveryAttemptId: claimed.id,
          html,
          operationId,
          previewUrl,
          resultContent:
            typeof result.content === 'string'
              ? result.content
              : JSON.stringify({ preview_url: previewUrl, success: true }),
          resultState:
            result.state && typeof result.state === 'object'
              ? (result.state as Record<string, unknown>)
              : undefined,
          sourceMessageId: params.turn?.sourceMessageId,
          title,
          topicId,
          userId,
          workspaceId,
        });
      } catch (error) {
        console.error('[ensureDingpanDeliverable] persist tool message non-fatal:', error);
      }

      const done = await deliveryModel.markSucceeded(claimed.id, {
        claimToken,
        fileId,
        metadata: {
          payload: {
            apiName: 'uploadHtmlToDingpan',
            html,
            taskType: 'Bot报告',
            title,
            userName,
          },
          source: 'ensureDingpanDeliverable',
          topicId,
        },
        previewUrl,
        spaceId,
        verificationStatus: 'verified',
      });
      if (!done) {
        return {
          deliveryAttemptId: claimed.id,
          error: 'delivery claim lost before success write',
          uploaded: false,
          verificationStatus: 'pending',
        };
      }
      heldClaimToken = undefined;
      await recordOutcomeVerified({
        db,
        operationId,
        previewUrl,
        userId,
        workspaceId,
      });

      recordDeliveryMetric('succeeded', 1, {
        source: 'ensure',
        operationId,
        deliveryAttemptId: claimed.id,
      });
      return {
        deliveryAttemptId: claimed.id,
        previewUrl,
        uploaded: true,
        verificationStatus: 'verified',
      };
    } catch (error) {
      console.error('[ensureDingpanDeliverable] non-fatal:', error);
      const message = error instanceof Error ? error.message : String(error);
      let failedWrite = false;
      try {
        // Only the token this invocation minted — never re-read claimToken from DB
        // (another worker may own the row after lease expiry).
        if (heldClaimToken && heldClaimId) {
          const failed = await deliveryModel.markFailed(heldClaimId, {
            claimToken: heldClaimToken,
            errorCode: 'dingpan_delivery_exception',
            errorMessage: message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + 15_000),
            retryable: true,
          });
          failedWrite = Boolean(failed);
        }
      } catch {
        /* ignore secondary failure */
      }
      if (failedWrite) {
        await recordOutcomeFailed({
          db,
          errorCode: 'dingpan_delivery_exception',
          operationId,
          retryable: true,
          userId,
          workspaceId,
        });
      }
      return {
        error: message,
        uploaded: false,
        verificationStatus: failedWrite ? 'failed' : 'pending',
      };
    } finally {
      inFlightByKey.delete(key);
    }
  })();

  inFlightByKey.set(key, work);
  return work;
}
