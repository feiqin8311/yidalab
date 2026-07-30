import type { LobeChatDatabase } from '@lobechat/database';
import {
  ALL_FILE_CARDS_MAX_CHARS,
  isSpreadsheetFile,
  shouldInlineParsedText,
} from '@lobechat/file-loaders';
import type {
  ChatAudioItem,
  ChatFileItem,
  ChatFileParseStatus,
  ChatImageItem,
  ChatVideoItem,
  RuntimeDiagnostic,
} from '@lobechat/types';
import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { WorkbookService } from '@/server/services/workbook';

const log = debug('lobe-server:resolveAttachments');

export interface ResolvedAttachments {
  audioList: ChatAudioItem[];
  /**
   * Recoverable parse/tool diagnostics — session continues even if one file fails.
   */
  diagnostics: RuntimeDiagnostic[];
  fileList: ChatFileItem[];
  imageList: ChatImageItem[];
  /**
   * The subset of caller-provided fileIds that were successfully resolved,
   * in caller order. Use this when storing the file→message relation so it
   * matches the order the user uploaded.
   */
  orderedFileIds: string[];
  videoList: ChatVideoItem[];
  warnings: string[];
}

interface ResolveArgs {
  db: LobeChatDatabase;
  fileIds: string[];
  userId: string;
  workspaceId?: string;
}

const dedupe = (ids: string[]) => Array.from(new Set(ids));

const LEGACY_CONTENT_HARD_CAP = 80_000;

/**
 * Resolve fileIds into image/video/file lists for the LLM prompt layer.
 *
 * Spreadsheets use structured workbook manifests (never full grid dumps).
 * Other non-media files may still use DocumentService.parseFile, but content
 * is budgeted and legacy mega-documents are capped before prompt injection.
 */
export const resolveAttachmentsByFileIds = async ({
  db,
  fileIds,
  userId,
  workspaceId,
}: ResolveArgs): Promise<ResolvedAttachments> => {
  const result: ResolvedAttachments = {
    audioList: [],
    diagnostics: [],
    fileList: [],
    imageList: [],
    orderedFileIds: [],
    videoList: [],
    warnings: [],
  };
  if (fileIds.length === 0) return result;

  const dedupedFileIds = dedupe(fileIds);
  const fileModel = new FileModel(db, userId, workspaceId);
  const fileService = new FileService(db, userId, workspaceId);
  const fileRecords = await fileModel.findByIds(dedupedFileIds);
  if (fileRecords.length === 0) {
    log('no file records found for fileIds=%O', dedupedFileIds);
    return result;
  }

  const documentService = new DocumentService(db, userId, workspaceId);
  const workbookService = new WorkbookService(db, userId, workspaceId);
  const recordById = new Map(fileRecords.map((f) => [f.id, f]));

  const resolved = await Promise.all(
    dedupedFileIds.map(async (id) => {
      const file = recordById.get(id);
      if (!file) {
        return { id, missing: true as const };
      }
      const resolvedUrl = (await fileService.getFullFileUrl(file.url)) || file.url;
      const fileType = file.fileType || '';
      if (
        fileType.startsWith('image') ||
        fileType.startsWith('video') ||
        fileType.startsWith('audio')
      ) {
        return { file, fileType, id, resolvedUrl };
      }

      // Spreadsheets → structured workbook path (no full markdown dump)
      if (isSpreadsheetFile(fileType, file.name)) {
        try {
          const inspect = await workbookService.inspectWorkbook(file.id);
          return {
            content: inspect.promptCard,
            file,
            fileType,
            id,
            parseStatus: inspect.parseStatus as ChatFileParseStatus,
            resolvedUrl,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: `Spreadsheet "${file.name}" is not query-ready yet (${message}). Retry inspectWorkbook later. Other attachments remain available.`,
            diagnostic: {
              code: 'workbook_parse_failed',
              fileId: file.id,
              message,
              recoverable: true,
              severity: 'warning' as const,
              source: 'file_parser' as const,
            },
            file,
            fileType,
            id,
            parseError: error,
            parseStatus: 'failed' as ChatFileParseStatus,
            resolvedUrl,
          };
        }
      }

      let content: string | undefined;
      let parseError: unknown;
      try {
        const document = await documentService.parseFile(file.id);
        content = document.content ?? undefined;
        if (content && content.length > LEGACY_CONTENT_HARD_CAP) {
          content = `${content.slice(0, LEGACY_CONTENT_HARD_CAP)}\n\n…[legacy document body capped at ${LEGACY_CONTENT_HARD_CAP} chars; re-upload or use tools for full coverage]`;
        }
        if (
          content &&
          !shouldInlineParsedText({
            content,
            size: file.size ?? 0,
          })
        ) {
          content = `File id=${file.id} name="${file.name}" size=${file.size} is too large to inline (token budget). Prefer cloud-sandbox or re-export a smaller extract.`;
        }
      } catch (error) {
        parseError = error;
      }
      return { content, file, fileType, id, parseError, resolvedUrl };
    }),
  );

  let cardBudget = ALL_FILE_CARDS_MAX_CHARS;

  for (const entry of resolved) {
    if ('missing' in entry) {
      result.warnings.push(`Attachment "${entry.id}" was not found and skipped.`);
      continue;
    }
    if ('diagnostic' in entry && entry.diagnostic) {
      result.diagnostics.push(entry.diagnostic);
    }
    const { file, fileType, resolvedUrl } = entry;
    result.orderedFileIds.push(file.id);
    if (fileType.startsWith('image')) {
      result.imageList.push({ alt: file.name || 'image', id: file.id, url: resolvedUrl });
      continue;
    }
    if (fileType.startsWith('video')) {
      result.videoList.push({ alt: file.name || 'video', id: file.id, url: resolvedUrl });
      continue;
    }
    if (fileType.startsWith('audio')) {
      result.audioList.push({ alt: file.name || 'audio', id: file.id, url: resolvedUrl });
      continue;
    }
    if (entry.parseError && !entry.content) {
      log('parseFile failed for %s (id=%s): %O', file.name, file.id, entry.parseError);
      result.warnings.push(
        `File "${file.name || 'unknown'}" was attached but its contents could not be extracted.`,
      );
    }

    let content = entry.content;
    if (content && content.length > cardBudget) {
      content = `${content.slice(0, Math.max(0, cardBudget))}\n…[attachment card budget]`;
    }
    if (content) cardBudget = Math.max(0, cardBudget - content.length);

    result.fileList.push({
      content,
      fileType: fileType || 'application/octet-stream',
      id: file.id,
      name: file.name || 'file',
      parseStatus: entry.parseStatus,
      size: file.size ?? 0,
      url: resolvedUrl,
    });
  }

  log(
    'resolved %d attachment(s) (%d images, %d videos, %d audios, %d documents)',
    fileRecords.length,
    result.imageList.length,
    result.videoList.length,
    result.audioList.length,
    result.fileList.length,
  );

  return result;
};

/**
 * Metadata-only resolver for UI rendering (CommentCard, TaskInstruction) and
 * prompt rendering (buildTaskPrompt). Skips `DocumentService.parseFile` so it
 * stays fast and does not block on large PDFs. Items returned in caller order;
 * missing files are dropped.
 *
 * Pass `signUrls: false` when the caller doesn't need playable URLs (e.g.
 * prompt rendering only uses name + fileType) — saves N presigned-URL fetches.
 */
export const resolveAttachmentMetadata = async ({
  db,
  fileIds,
  signUrls = true,
  userId,
  workspaceId,
}: ResolveArgs & { signUrls?: boolean }): Promise<ChatFileItem[]> => {
  if (fileIds.length === 0) return [];

  const dedupedFileIds = dedupe(fileIds);
  const fileModel = new FileModel(db, userId, workspaceId);
  const fileRecords = await fileModel.findByIds(dedupedFileIds);
  if (fileRecords.length === 0) {
    log('no file records found for fileIds=%O', dedupedFileIds);
    return [];
  }

  const fileService = signUrls ? new FileService(db, userId, workspaceId) : null;
  const recordById = new Map(fileRecords.map((f) => [f.id, f]));
  const items: ChatFileItem[] = [];
  for (const id of dedupedFileIds) {
    const file = recordById.get(id);
    if (!file) continue;
    const url = fileService ? (await fileService.getFullFileUrl(file.url)) || file.url : file.url;
    items.push({
      fileType: file.fileType || 'application/octet-stream',
      id: file.id,
      name: file.name || 'file',
      parseStatus: (file as { parseStatus?: ChatFileParseStatus }).parseStatus,
      size: file.size ?? 0,
      url,
    });
  }
  return items;
};
