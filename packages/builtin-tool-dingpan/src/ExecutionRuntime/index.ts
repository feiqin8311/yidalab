import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  DingpanStatusParams,
  DingpanStatusState,
  UploadHtmlToDingpanParams,
  UploadToDingpanParams,
  UploadToDingpanState,
} from '../types';
import {
  dingpanConfigStatus,
  uploadFileToDingpan,
  uploadHtmlToDingpan as uploadHtmlBytes,
} from './uploadCore';

/**
 * Optional hooks so the server runtime can persist deliverables per-user
 * (documents table) without coupling this package to the database layer.
 */
export interface DingpanDocumentBridge {
  /**
   * Create a private deliverable document for the current user/topic.
   * Returns the new document id.
   */
  createDeliverableDocument: (input: {
    content: string;
    title: string;
    topicId?: string;
  }) => Promise<{ id: string }>;
  /** Load HTML content for a document owned by the current user. */
  getDeliverableHtml: (documentId: string) => Promise<{ content: string; title?: string } | null>;
  /** Patch dingpan metadata after a successful upload (ownership already checked). */
  patchDingpanMetadata: (
    documentId: string,
    meta: { fileId?: string; name?: string; previewUrl: string },
  ) => Promise<void>;
}

export interface DingpanExecutionRuntimeOptions {
  documentBridge?: DingpanDocumentBridge;
}

/**
 * Dingpan Execution Runtime — pure Node upload via DingTalk Storage API.
 * Default folder / secrets come from process env (server .env or injected creds).
 * Per-call folderLink / spaceId+folderId override the default.
 */
export class DingpanExecutionRuntime {
  private readonly documentBridge?: DingpanDocumentBridge;

  constructor(options: DingpanExecutionRuntimeOptions = {}) {
    this.documentBridge = options.documentBridge;
  }

  async uploadToDingpan(args: UploadToDingpanParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await uploadFileToDingpan({
        filePath: args.filePath,
        folderId: args.folderId,
        folderLink: args.folderLink,
        spaceId: args.spaceId,
        uploadName: args.uploadName,
      });

      if (!result.previewUrl) {
        return {
          content: `Upload committed but no preview URL (fileId missing). name=${result.name}`,
          success: false,
        };
      }

      const state: UploadToDingpanState = {
        fileId: result.fileId,
        filePath: args.filePath,
        name: result.name,
        previewUrl: result.previewUrl,
        success: true,
      };

      return {
        content: JSON.stringify(
          {
            file_id: result.fileId,
            name: result.name,
            preview_url: result.previewUrl,
            success: true,
          },
          null,
          2,
        ),
        state,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: message,
        error: { message, type: 'DingpanUploadError' },
        success: false,
      };
    }
  }

  /**
   * Persist (optional) + upload HTML string to Dingpan.
   * Prefer documentId when the deliverable was already saved; otherwise html is required.
   */
  async uploadHtmlToDingpan(args: UploadHtmlToDingpanParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      let documentId = args.documentId?.trim() || undefined;
      let html = args.html?.trim() || '';
      let title = args.title?.trim() || args.uploadName?.trim() || '';

      if (documentId) {
        if (!this.documentBridge) {
          return {
            content:
              'documentId was provided but document bridge is unavailable on this runtime host.',
            error: { message: 'Document bridge unavailable', type: 'DingpanUploadError' },
            success: false,
          };
        }
        const doc = await this.documentBridge.getDeliverableHtml(documentId);
        if (!doc?.content?.trim()) {
          return {
            content: `Document not found or empty for current user: ${documentId}`,
            error: { message: 'Document not found', type: 'DingpanUploadError' },
            success: false,
          };
        }
        html = doc.content;
        if (!title) title = doc.title || documentId;
      }

      if (!html) {
        return {
          content: 'html or documentId with content is required',
          error: { message: 'Missing html content', type: 'DingpanUploadError' },
          success: false,
        };
      }

      // Persist before upload when no document yet — source of truth for audit.
      if (!documentId && this.documentBridge) {
        const stamp = new Date()
          .toISOString()
          .replaceAll(/[-:TZ.]/g, '')
          .slice(0, 14);
        const created = await this.documentBridge.createDeliverableDocument({
          content: html,
          title: title || `report-${stamp}`,
          topicId: args.topicId,
        });
        documentId = created.id;
      }

      const result = await uploadHtmlBytes({
        asin: args.asin,
        folderId: args.folderId,
        folderLink: args.folderLink,
        html,
        keyword: args.keyword,
        productName: args.productName,
        site: args.site,
        spaceId: args.spaceId,
        taskType: args.taskType,
        // Prefer structured naming; only pass free-form uploadName when the caller set it.
        // Do not fall back to document title (avoids random titles / legacy agent names).
        uploadName: args.uploadName,
        userName: args.userName,
      });

      if (!result.previewUrl) {
        return {
          content: `Upload committed but no preview URL (fileId missing). name=${result.name}`,
          success: false,
        };
      }

      if (documentId && this.documentBridge) {
        try {
          await this.documentBridge.patchDingpanMetadata(documentId, {
            fileId: result.fileId,
            name: result.name,
            previewUrl: result.previewUrl,
          });
        } catch (error) {
          console.error('[Dingpan] failed to patch document metadata', error);
        }
      }

      const state: UploadToDingpanState = {
        documentId,
        fileId: result.fileId,
        name: result.name,
        previewUrl: result.previewUrl,
        success: true,
      };

      return {
        content: JSON.stringify(
          {
            document_id: documentId,
            file_id: result.fileId,
            name: result.name,
            preview_url: result.previewUrl,
            success: true,
          },
          null,
          2,
        ),
        state,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: message,
        error: { message, type: 'DingpanUploadError' },
        success: false,
      };
    }
  }

  async dingpanStatus(_args: DingpanStatusParams = {}): Promise<BuiltinServerRuntimeOutput> {
    const status = dingpanConfigStatus();
    const state: DingpanStatusState = status;
    return {
      content: JSON.stringify(status, null, 2),
      state,
      success: true,
    };
  }
}
