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
 */

import { type DeliveryClaimMessage, extractDingpanUploadOutcomes } from '@lobechat/agent-runtime';
import { DingpanApiName, DingpanIdentifier } from '@lobechat/builtin-tool-dingpan';
import {
  type DingpanDocumentBridge,
  DingpanExecutionRuntime,
} from '@lobechat/builtin-tool-dingpan/executionRuntime';
import { createNanoId } from '@lobechat/database';
import type { ChatToolPayload } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { DocumentService } from '@/server/services/document';
import { withVaultCredEnv } from '@/server/utils/withVaultCredEnv';

import { shouldEnsureDingpanForBotReply, wrapBotReplyAsHtml } from './botDingpanDeliveryHeuristic';
import type { BotTurnContext } from './botTurnContext';

/** In-process idempotency for concurrent ensure calls on the same operation. */
const inFlightByKey = new Map<string, Promise<EnsureDingpanDeliverableResult>>();

const deliveryKey = (operationId: string) => `dingpan-delivery:${operationId}:report`;

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

/**
 * Persist system fallback upload as a dual-form tool message so Web history can
 * preview HTML from arguments.html (same surface as model uploadHtmlToDingpan).
 * Prefers explicit assistantMessageId; falls back to spine only when missing.
 */
const persistBotDingpanToolMessage = async (params: {
  assistantMessageId?: string;
  db: LobeChatDatabase;
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
    pluginState: params.resultState ?? {
      name: params.title,
      previewUrl: params.previewUrl,
      success: true,
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
    try {
      const existing = await latestSuccessfulPreviewForOperation({
        db,
        operationId,
        topicId,
        userId,
        workspaceId,
      });
      if (existing) return { previewUrl: existing, uploaded: false };

      const userName = await resolveUserDisplayName(db, userId);
      const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const title = `Bot报告_${userName || 'YidaLab'}_${stamp}`;
      const html = wrapBotReplyAsHtml(reply, title);

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
        return { error: err, uploaded: false };
      }

      let previewUrl: string | undefined;
      try {
        const payload =
          typeof result.content === 'string'
            ? (JSON.parse(result.content) as Record<string, unknown>)
            : null;
        previewUrl = String(payload?.preview_url ?? payload?.previewUrl ?? '').trim() || undefined;
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

      if (!previewUrl) {
        return { error: 'upload succeeded but preview_url missing', uploaded: false };
      }

      try {
        await persistBotDingpanToolMessage({
          assistantMessageId: params.turn?.assistantMessageId,
          db,
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

      return { previewUrl, uploaded: true };
    } catch (error) {
      console.error('[ensureDingpanDeliverable] non-fatal:', error);
      return {
        error: error instanceof Error ? error.message : String(error),
        uploaded: false,
      };
    } finally {
      inFlightByKey.delete(key);
    }
  })();

  inFlightByKey.set(key, work);
  return work;
}
