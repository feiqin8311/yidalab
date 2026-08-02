import type { LobeChatDatabase } from '@lobechat/database';
import { isSpreadsheetFile, loadFile, UnsupportedFileTypeError } from '@lobechat/file-loaders';
import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { FileService } from '@/server/services/file';

const log = debug('lobe-server:attachment-extract');

/** Soft in-process cache TTL for tool re-reads within the same node process. */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 32;
/** Total cached body chars across all entries (prevents multi-GB heap from large PDFs). */
const CACHE_MAX_TOTAL_CHARS = 8 * 1024 * 1024; // 8MB aggregate
/** Skip caching a single extract larger than this (still returned to caller). */
const CACHE_MAX_ENTRY_CHARS = 2 * 1024 * 1024; // 2MB

export interface AttachmentPage {
  content: string;
  pageNumber: number;
}

export interface AttachmentFullExtract {
  content: string;
  fileId: string;
  fileType: string;
  name: string;
  pages?: AttachmentPage[];
  parseStatus: 'ready' | 'partial' | 'unsupported' | 'failed';
  processingPolicy?: string | null;
  size: number;
  totalLength: number;
  warnings: string[];
}

interface CacheEntry {
  expiresAt: number;
  /** Approximate body size for budget accounting. */
  sizeChars: number;
  value: AttachmentFullExtract;
}

const extractCache = new Map<string, CacheEntry>();
let cacheTotalChars = 0;

const cacheKey = (userId: string, workspaceId: string | undefined, fileId: string) =>
  `${userId}:${workspaceId ?? ''}:${fileId}`;

const getCached = (key: string): AttachmentFullExtract | undefined => {
  const hit = extractCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cacheTotalChars = Math.max(0, cacheTotalChars - hit.sizeChars);
    extractCache.delete(key);
    return undefined;
  }
  return hit.value;
};

const entrySizeChars = (value: AttachmentFullExtract): number => {
  // Prefer pages-only accounting when present (content is join of pages).
  if (value.pages?.length) {
    return value.pages.reduce((n, p) => n + (p.content?.length ?? 0), 0);
  }
  return value.content?.length ?? 0;
};

const setCached = (key: string, value: AttachmentFullExtract) => {
  const sizeChars = entrySizeChars(value);
  if (sizeChars > CACHE_MAX_ENTRY_CHARS) {
    log('skip cache for %s (%d chars > entry cap)', key, sizeChars);
    return;
  }

  // Evict oldest until under budget / entry count.
  while (
    extractCache.size >= CACHE_MAX_ENTRIES ||
    cacheTotalChars + sizeChars > CACHE_MAX_TOTAL_CHARS
  ) {
    const oldest = extractCache.keys().next().value;
    if (!oldest) break;
    const old = extractCache.get(oldest);
    if (old) cacheTotalChars = Math.max(0, cacheTotalChars - old.sizeChars);
    extractCache.delete(oldest);
  }

  if (cacheTotalChars + sizeChars > CACHE_MAX_TOTAL_CHARS) return;

  extractCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, sizeChars, value });
  cacheTotalChars += sizeChars;
};

/** Test-only: clear process cache between unit tests. */
export const __clearAttachmentExtractCacheForTests = () => {
  extractCache.clear();
  cacheTotalChars = 0;
};

/**
 * Full on-demand extract for lobe-files tools — NOT for prompt cards.
 * Does not apply the 80k / token-budget caps used by ContextResourceResolver.
 * Never writes documents/chunks/workbook assets.
 */
export class AttachmentExtractService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly fileModel: FileModel;
  private readonly fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.fileModel = new FileModel(db, userId, workspaceId);
    this.fileService = new FileService(db, userId, workspaceId);
  }

  /**
   * Metadata-only check (no download/parse). Returns null if not readable.
   */
  inspectMeta = async (fileId: string) => {
    const file = await this.fileModel.findById(fileId);
    if (!file) return null;
    return {
      fileType: file.fileType || 'application/octet-stream',
      id: file.id,
      name: file.name || 'file',
      parseStatus: (file as { parseStatus?: string | null }).parseStatus,
      processingPolicy: (file as { processingPolicy?: string | null }).processingPolicy,
      size: file.size ?? 0,
    };
  };

  /**
   * Full text extract with optional page slices. Cached briefly per process
   * when under size budget (pages preferred over duplicating full content).
   */
  extractFull = async (fileId: string): Promise<AttachmentFullExtract> => {
    const key = cacheKey(this.userId, this.workspaceId, fileId);
    const cached = getCached(key);
    if (cached) return cached;

    const file = await this.fileModel.findById(fileId);
    if (!file) {
      return {
        content: '',
        fileId,
        fileType: 'application/octet-stream',
        name: 'file',
        parseStatus: 'failed',
        size: 0,
        totalLength: 0,
        warnings: [`Attachment "${fileId}" was not found or is not readable.`],
      };
    }

    const fileType = file.fileType || '';
    const isSheet = isSpreadsheetFile(fileType, file.name || '');
    let cleanup: (() => void) | undefined;

    try {
      const downloaded = await this.fileService.downloadFileToLocal(fileId, {
        id: file.id,
        name: file.name,
        url: file.url,
      });
      cleanup = downloaded.cleanup;

      const fileDocument = await loadFile(downloaded.filePath);
      let content = fileDocument.content || '';
      const warnings: string[] = [];
      let parseStatus: AttachmentFullExtract['parseStatus'] = 'ready';

      if (fileDocument.metadata?.error) {
        warnings.push(String(fileDocument.metadata.error));
        parseStatus = content ? 'partial' : 'failed';
      }

      const pages: AttachmentPage[] | undefined = fileDocument.pages?.map((page, index) => ({
        content: page.pageContent || '',
        pageNumber: Number(page.metadata?.pageNumber ?? index + 1),
      }));

      if (isSheet) {
        warnings.push(
          'Spreadsheet full extract is raw text; prefer lobe-workbook for structured queries.',
        );
        parseStatus = 'partial';
      }

      if (!content.trim() && !pages?.some((p) => p.content.trim())) {
        return {
          content: '',
          fileId: file.id,
          fileType: fileType || 'application/octet-stream',
          name: file.name || 'file',
          pages,
          parseStatus: parseStatus === 'failed' ? 'failed' : 'unsupported',
          processingPolicy: (file as { processingPolicy?: string | null }).processingPolicy,
          size: file.size ?? 0,
          totalLength: 0,
          warnings: warnings.length
            ? warnings
            : [`File "${file.name}" produced no extractable text.`],
        };
      }

      // Prefer joined page text when content empty but pages exist.
      if (!content.trim() && pages?.length) {
        content = pages.map((p) => p.content).join('\n\n');
      }

      // Cache pages OR content, not both (pages already cover full body).
      const cacheValue: AttachmentFullExtract = {
        content: pages?.length ? '' : content,
        fileId: file.id,
        fileType: fileType || 'application/octet-stream',
        name: file.name || 'file',
        pages,
        parseStatus,
        processingPolicy: (file as { processingPolicy?: string | null }).processingPolicy,
        size: file.size ?? 0,
        totalLength: content.length,
        warnings,
      };
      setCached(key, cacheValue);

      // Always return full content to caller.
      return {
        ...cacheValue,
        content,
      };
    } catch (error) {
      if (error instanceof UnsupportedFileTypeError) {
        return {
          content: '',
          fileId: file.id,
          fileType: fileType || 'application/octet-stream',
          name: file.name || 'file',
          parseStatus: 'unsupported',
          processingPolicy: (file as { processingPolicy?: string | null }).processingPolicy,
          size: file.size ?? 0,
          totalLength: 0,
          warnings: [error.message],
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      log('full extract failed for %s: %O', fileId, error);
      return {
        content: '',
        fileId: file.id,
        fileType: fileType || 'application/octet-stream',
        name: file.name || 'file',
        parseStatus: 'failed',
        processingPolicy: (file as { processingPolicy?: string | null }).processingPolicy,
        size: file.size ?? 0,
        totalLength: 0,
        warnings: [`File "${file.name}" could not be extracted: ${message}`],
      };
    } finally {
      cleanup?.();
    }
  };
}
