/**
 * System-side dingpan delivery guarantee for bot completions.
 *
 * Product invariant: report-class bot answers must end with a real 钉盘
 * preview_url (or an explicit failure). Models may skip uploadHtmlToDingpan;
 * forceFinish used to strip all tools. This module uploads a deterministic
 * HTML wrap of the final reply when the topic has no successful upload yet.
 */

import { type DeliveryClaimMessage, extractDingpanUploadOutcomes } from '@lobechat/agent-runtime';
import {
  type DingpanDocumentBridge,
  DingpanExecutionRuntime,
} from '@lobechat/builtin-tool-dingpan/executionRuntime';

import { MessageModel } from '@/database/models/message';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { DocumentService } from '@/server/services/document';
import { withVaultCredEnv } from '@/server/utils/withVaultCredEnv';

import { shouldEnsureDingpanForBotReply, wrapBotReplyAsHtml } from './botDingpanDeliveryHeuristic';

const createDocumentBridge = (
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId?: string | null,
): DingpanDocumentBridge => {
  const documentService = new DocumentService(serverDB, userId, workspaceId ?? undefined);

  return {
    createDeliverableDocument: async ({ content, title, topicId }) => {
      const doc = await documentService.createDocument({
        content,
        editorData: {},
        fileType: 'text/html',
        metadata: {
          deliverable: true,
          source: 'bot-system-dingpan',
          ...(topicId ? { topicId } : {}),
        },
        title,
        visibility: 'private',
      });
      return { id: doc.id };
    },

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

const latestSuccessfulPreview = async (params: {
  db: LobeChatDatabase;
  topicId: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<string | undefined> => {
  const messageModel = new MessageModel(params.db, params.userId, params.workspaceId ?? undefined);
  const rows = await messageModel.findRecentDingpanUploadsInTopic(params.topicId);
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

export type EnsureDingpanDeliverableResult = {
  previewUrl?: string;
  /** Whether this call performed a new upload */
  uploaded: boolean;
  error?: string;
};

/**
 * If the bot reply looks report-class and the topic has no successful dingpan
 * upload, wrap the reply as HTML and upload via the same runtime as tools.
 */
export async function ensureDingpanDeliverable(params: {
  db: LobeChatDatabase;
  reply: string;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}): Promise<EnsureDingpanDeliverableResult> {
  const { db, userId, workspaceId, topicId } = params;
  const reply = params.reply.trim();
  if (!reply || !topicId) return { uploaded: false };
  if (!shouldEnsureDingpanForBotReply(reply)) return { uploaded: false };

  try {
    const existing = await latestSuccessfulPreview({ db, topicId, userId, workspaceId });
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
      // Re-read topic in case tool content shape differs
      previewUrl = await latestSuccessfulPreview({ db, topicId, userId, workspaceId });
    }

    if (!previewUrl) {
      return { error: 'upload succeeded but preview_url missing', uploaded: false };
    }

    return { previewUrl, uploaded: true };
  } catch (error) {
    console.error('[ensureDingpanDeliverable] non-fatal:', error);
    return {
      error: error instanceof Error ? error.message : String(error),
      uploaded: false,
    };
  }
}
