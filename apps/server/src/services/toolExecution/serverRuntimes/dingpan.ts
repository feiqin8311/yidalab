import { DingpanManifest } from '@lobechat/builtin-tool-dingpan';
import {
  type DingpanDocumentBridge,
  DingpanExecutionRuntime,
} from '@lobechat/builtin-tool-dingpan/executionRuntime';
import type { LobeChatDatabase } from '@lobechat/database';

import { UserModel } from '@/database/models/user';
import { DocumentService } from '@/server/services/document';
import { withVaultCredEnv } from '@/server/utils/withVaultCredEnv';

import { type ServerRuntimeRegistration } from './types';

const resolveUserDisplayName = async (
  serverDB: LobeChatDatabase | undefined,
  userId: string | undefined,
): Promise<string | undefined> => {
  if (!serverDB || !userId) return undefined;
  try {
    const row = await UserModel.findById(serverDB, userId);
    const name =
      row?.username?.trim() || [row?.firstName, row?.lastName].filter(Boolean).join('').trim();
    return name || undefined;
  } catch {
    return undefined;
  }
};

const createDocumentBridge = (
  serverDB: LobeChatDatabase | undefined,
  userId: string | undefined,
  workspaceId?: string | null,
): DingpanDocumentBridge | undefined => {
  if (!serverDB || !userId) return undefined;

  const documentService = new DocumentService(serverDB, userId, workspaceId ?? undefined);

  return {
    getDeliverableHtml: async (documentId) => {
      const doc = await documentService.getDocumentById(documentId);
      // DocumentModel.findById is already scoped to userId/workspaceId.
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
          source: prev.source ?? 'dingpan-html',
        },
      });
    },
  };
};

export const dingpanRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const bridge = createDocumentBridge(context.serverDB, context.userId, context.workspaceId);
    const baseRuntime = new DingpanExecutionRuntime({ documentBridge: bridge });

    return {
      // Company `dingtalk` (APP_KEY/SECRET) + personal `dingtalk-dingpan` (folder/id).
      dingpanStatus: async (args: any) =>
        withVaultCredEnv(context.userId, context.serverDB, () => baseRuntime.dingpanStatus(args)),
      uploadHtmlToDingpan: async (args: any) =>
        withVaultCredEnv(context.userId, context.serverDB, async () => {
          const injectedUserName =
            (typeof args?.userName === 'string' && args.userName.trim()) ||
            (await resolveUserDisplayName(context.serverDB, context.userId));
          return baseRuntime.uploadHtmlToDingpan({
            ...args,
            // Prefer explicit arg; fall back to agent context topic when present.
            topicId: args?.topicId ?? context.topicId,
            // Human user display name for filename (not agent name).
            userName: injectedUserName,
          });
        }),
      uploadToDingpan: async (args: any) =>
        withVaultCredEnv(context.userId, context.serverDB, () => baseRuntime.uploadToDingpan(args)),
    };
  },
  identifier: DingpanManifest.identifier,
};
