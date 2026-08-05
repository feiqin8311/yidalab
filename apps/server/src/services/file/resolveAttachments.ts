import type { LobeChatDatabase } from '@lobechat/database';
import { ALL_FILE_CARDS_MAX_CHARS } from '@lobechat/file-loaders';
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
import { FileService } from '@/server/services/file';
import {
  ContextResourceResolver,
  type ContextResourceResult,
} from '@/server/services/file/contextResourceResolver';

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
  /** Cap concurrent non-media resolves (default 4). */
  concurrency?: number;
  db: LobeChatDatabase;
  fileIds: string[];
  userId: string;
  workspaceId?: string;
  /**
   * `never` for client prompt hydrate (no DocumentService write / workbook enqueue).
   * Default `allow` preserves gateway behavior for persistent resources.
   */
  writeMode?: 'allow' | 'never';
}

const dedupe = (ids: string[]) => Array.from(new Set(ids));

/** Exported for concurrency unit tests. */
export const mapPool = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const limit = Math.max(1, concurrency);
  const results = Array.from({ length: items.length }) as R[];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * Resolve fileIds into image/video/file lists for the LLM prompt layer.
 *
 * Uses ContextResourceResolver for non-media files. Pass writeMode='never' so
 * prompt-time hydrate never writes documents/chunks via DocumentService.parseFile.
 */
export const resolveAttachmentsByFileIds = async ({
  db,
  fileIds,
  userId,
  workspaceId,
  writeMode = 'allow',
  concurrency = 4,
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
  // Grant-aware batch (same ACL as findById); access context loaded once.
  const fileRecords = await fileModel.findReadableByIds(dedupedFileIds);
  if (fileRecords.length === 0) {
    log('no file records found for fileIds=%O', dedupedFileIds);
    return result;
  }

  const resolver = new ContextResourceResolver(db, userId, workspaceId);
  const recordById = new Map(fileRecords.map((f) => [f.id, f]));

  const resolved = await mapPool(dedupedFileIds, concurrency, async (id) => {
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

    try {
      const ctx = await resolver.resolveForPrompt(
        file.id,
        {},
        {
          file: {
            fileType: file.fileType || '',
            id: file.id,
            name: file.name || 'file',
            processingPolicy: (file as { processingPolicy?: string | null }).processingPolicy,
            size: file.size ?? null,
            url: file.url,
          },
          ...(writeMode === 'never' ? { writeMode: 'never' as const } : {}),
        },
      );
      return {
        content: ctx.content,
        diagnostic: ctx.diagnostic,
        file,
        fileType,
        id,
        parseStatus: ctx.parseStatus,
        resolvedUrl,
        resolveStatus: ctx.status,
        warnings: ctx.warnings,
      };
    } catch (error) {
      return {
        file,
        fileType,
        id,
        parseError: error,
        resolvedUrl,
      };
    }
  });

  let cardBudget = ALL_FILE_CARDS_MAX_CHARS;

  for (const entry of resolved) {
    if ('missing' in entry) {
      result.warnings.push(`Attachment "${entry.id}" was not found and skipped.`);
      continue;
    }
    if ('diagnostic' in entry && entry.diagnostic) {
      result.diagnostics.push(entry.diagnostic);
    }
    if ('warnings' in entry && entry.warnings?.length) {
      result.warnings.push(...entry.warnings);
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
      log('resolve failed for %s (id=%s): %O', file.name, file.id, entry.parseError);
      result.warnings.push(
        `File "${file.name || 'unknown'}" was attached but its contents could not be extracted.`,
      );
    }

    let content = entry.content;
    if (content && content.length > cardBudget) {
      content = `${content.slice(0, Math.max(0, cardBudget))}\n…[attachment card budget]`;
    }
    if (content) cardBudget = Math.max(0, cardBudget - content.length);

    // Prefer structured parseStatus; fall back to ContextResourceResolver status
    // so partial/failed/unsupported cards can advertise lobe-files tools.
    const resolveStatus =
      'resolveStatus' in entry
        ? (entry.resolveStatus as ContextResourceResult['status'] | undefined)
        : undefined;
    let parseStatus = (entry.parseStatus ??
      (resolveStatus === 'ready' ||
      resolveStatus === 'partial' ||
      resolveStatus === 'failed' ||
      resolveStatus === 'unsupported'
        ? resolveStatus
        : undefined)) as ChatFileParseStatus | undefined;

    // Explicit empty body so the model does not treat a bare file URL as crawlable text.
    // Force parseStatus=failed so file cards advertise availableTool=lobe-files/* —
    // otherwise a non-empty "ask for .txt" placeholder looks ready and the model
    // skips tools (DingTalk: first docx turn said "无法提取" without calling tools).
    if (!content) {
      const reason =
        entry.warnings?.join('; ') ||
        (entry.parseError instanceof Error ? entry.parseError.message : undefined) ||
        'no extractable text';
      content =
        `Attachment id=${file.id} name="${file.name || file.id}" could not provide inline text (${reason}). ` +
        `Do not download/crawl the file URL (binary). ` +
        `REQUIRED: call lobe-files/inspectAttachment then lobe-files/readAttachment with this fileId. ` +
        `Only if tools fail, ask the user to paste text or re-upload as .txt/.md.`;
      if (!parseStatus || parseStatus === 'ready') parseStatus = 'failed';
      result.warnings.push(
        `File "${file.name || 'unknown'}" had no extractable text for the prompt.`,
      );
    } else if (entry.parseError && parseStatus !== 'partial') {
      parseStatus = parseStatus ?? 'failed';
    }

    result.fileList.push({
      content,
      fileType: fileType || 'application/octet-stream',
      id: file.id,
      name: file.name || 'file',
      parseStatus,
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
 * prompt rendering (buildTaskPrompt). Skips content extraction so it
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
