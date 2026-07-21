import { DingpanManifest, DingpanPersonalCredKey } from '@lobechat/builtin-tool-dingpan';
import {
  type DingpanDocumentBridge,
  DingpanExecutionRuntime,
} from '@lobechat/builtin-tool-dingpan/executionRuntime';
import type { LobeChatDatabase } from '@lobechat/database';

import { UserCredentialModel } from '@/database/models/userCredential';
import { DocumentService } from '@/server/services/document';

import { type ServerRuntimeRegistration } from './types';

/**
 * Inject **personal** dingpan credential into process.env for this call.
 * Each user has their own folder path (DINGTALK_FOLDER_LINK etc.) under
 * personal credential key `dingtalk-dingpan`. Deploy/.env still wins if set.
 */
const withPersonalDingpanCredEnv = async <T>(
  userId: string | undefined,
  serverDB: LobeChatDatabase | undefined,
  fn: () => Promise<T>,
): Promise<T> => {
  if (!userId || !serverDB) return fn();

  try {
    const model = new UserCredentialModel(serverDB, userId);
    const personal = await model.listDecryptedKvEnv(null);

    // Prefer the dedicated dingpan credential; fall back to other personal kv-env keys.
    const dingpan = personal.find((b) => b.key === DingpanPersonalCredKey);
    const ordered = dingpan
      ? [dingpan, ...personal.filter((b) => b.key !== DingpanPersonalCredKey)]
      : personal;

    for (const bundle of ordered) {
      for (const [k, v] of Object.entries(bundle.values)) {
        if (!v?.trim()) continue;
        if (!process.env[k]?.trim()) process.env[k] = v;
      }
    }
  } catch {
    // Missing table / decrypt failure: still try with process env only.
  }

  return fn();
};

const createDocumentBridge = (
  serverDB: LobeChatDatabase | undefined,
  userId: string | undefined,
  workspaceId?: string | null,
): DingpanDocumentBridge | undefined => {
  if (!serverDB || !userId) return undefined;

  const documentService = new DocumentService(serverDB, userId, workspaceId ?? undefined);

  return {
    createDeliverableDocument: async ({ content, title, topicId }) => {
      const doc = await documentService.createDocument({
        content,
        editorData: {},
        fileType: 'text/html',
        metadata: {
          deliverable: true,
          source: 'dingpan-html',
          ...(topicId ? { topicId } : {}),
        },
        title,
        visibility: 'private',
      });
      return { id: doc.id };
    },

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
      dingpanStatus: async (args: any) =>
        withPersonalDingpanCredEnv(context.userId, context.serverDB, () =>
          baseRuntime.dingpanStatus(args),
        ),
      uploadHtmlToDingpan: async (args: any) =>
        withPersonalDingpanCredEnv(context.userId, context.serverDB, () =>
          baseRuntime.uploadHtmlToDingpan({
            ...args,
            // Prefer explicit arg; fall back to agent context topic when present.
            topicId: args?.topicId ?? context.topicId,
          }),
        ),
      uploadToDingpan: async (args: any) =>
        withPersonalDingpanCredEnv(context.userId, context.serverDB, () =>
          baseRuntime.uploadToDingpan(args),
        ),
    };
  },
  identifier: DingpanManifest.identifier,
};
