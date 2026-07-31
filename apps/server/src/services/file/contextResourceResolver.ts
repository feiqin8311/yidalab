import type { LobeChatDatabase } from '@lobechat/database';
import {
  ALL_FILE_CARDS_MAX_CHARS,
  isSpreadsheetFile,
  loadFile,
  shouldInlineParsedText,
  UnsupportedFileTypeError,
} from '@lobechat/file-loaders';
import type { ChatFileParseStatus, RuntimeDiagnostic } from '@lobechat/types';
import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { WorkbookService } from '@/server/services/workbook';

const log = debug('lobe-resource:context-resolver');

const LEGACY_CONTENT_HARD_CAP = 80_000;
/** Soft cap for on-demand spreadsheet sample cards (no long-lived workbook assets). */
const ON_DEMAND_SHEET_PREVIEW_MAX_CHARS = 8_000;

export interface ContextResourceResult {
  content?: string;
  diagnostic?: RuntimeDiagnostic;
  parseStatus?: ChatFileParseStatus;
  status: 'ready' | 'partial' | 'unsupported' | 'failed';
  warnings: string[];
}

export interface PromptResourceBudget {
  maxChars?: number;
}

/**
 * On-demand prompt content for message attachments.
 * NEVER writes documents / chunks / embeddings / workbook manifests.
 */
export class ContextResourceResolver {
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

  resolveForPrompt = async (
    fileId: string,
    budget: PromptResourceBudget = {},
  ): Promise<ContextResourceResult> => {
    const maxChars = budget.maxChars ?? LEGACY_CONTENT_HARD_CAP;
    const file = await this.fileModel.findById(fileId);
    if (!file) {
      return {
        status: 'failed',
        warnings: [`Attachment "${fileId}" was not found.`],
      };
    }

    const policy = (file as { processingPolicy?: string }).processingPolicy ?? 'on_demand';
    const fileType = file.fileType || '';

    // Persistent + already-parsed: prefer long-lived document / workbook assets.
    if (policy === 'persistent') {
      return this.resolvePersistent(fileId, file, fileType, maxChars);
    }

    return this.resolveOnDemand(fileId, file, fileType, maxChars);
  };

  private resolvePersistent = async (
    fileId: string,
    file: { name: string; size: number | null; fileType: string },
    fileType: string,
    maxChars: number,
  ): Promise<ContextResourceResult> => {
    if (isSpreadsheetFile(fileType, file.name)) {
      try {
        const workbookService = new WorkbookService(this.db, this.userId, this.workspaceId);
        const inspect = await workbookService.inspectWorkbook(fileId);
        return {
          content: inspect.promptCard,
          parseStatus: inspect.parseStatus as ChatFileParseStatus,
          status: inspect.parseStatus === 'ready' ? 'ready' : 'partial',
          warnings: [],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `Spreadsheet "${file.name}" is not query-ready yet (${message}). Upload via the Resources page for full workbook query if needed.`,
          diagnostic: {
            code: 'workbook_parse_failed',
            fileId,
            message,
            recoverable: true,
            severity: 'warning',
            source: 'file_parser',
          },
          parseStatus: 'failed',
          status: 'failed',
          warnings: [message],
        };
      }
    }

    // Reuse existing document row when present (from prior persistent parse).
    try {
      const documentService = new DocumentService(this.db, this.userId, this.workspaceId);
      // parseFile is gated by processingPolicy; for persistent files it may write.
      const document = await documentService.parseFile(fileId);
      let content = document.content ?? undefined;
      let status: ContextResourceResult['status'] = 'ready';
      const warnings: string[] = [];

      if (content && content.length > maxChars) {
        content = `${content.slice(0, maxChars)}\n\n…[document body capped at ${maxChars} chars; re-export a smaller extract or use lobe-workbook querySheet if this is a spreadsheet resource]`;
        status = 'partial';
        warnings.push(`Content truncated to ${maxChars} chars.`);
      }
      if (content && !shouldInlineParsedText({ content, size: file.size ?? 0 })) {
        content = `File id=${fileId} name="${file.name}" size=${file.size} is too large to inline (token budget). Upload via Resources for full indexing, or re-export a smaller extract. Do not use cloud sandbox.`;
        status = 'partial';
      }

      return { content, status, warnings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('persistent resolve failed for %s: %O', fileId, error);
      return {
        status: 'failed',
        warnings: [`File "${file.name}" could not be extracted: ${message}`],
      };
    }
  };

  private resolveOnDemand = async (
    fileId: string,
    file: { name: string; size: number | null; fileType: string; url: string },
    fileType: string,
    maxChars: number,
  ): Promise<ContextResourceResult> => {
    const isSheet = isSpreadsheetFile(fileType, file.name);
    // Spreadsheets: in-memory preview only (no workbook assets / documents write).
    const cap = isSheet ? Math.min(maxChars, ON_DEMAND_SHEET_PREVIEW_MAX_CHARS) : maxChars;

    let cleanup: (() => void) | undefined;
    try {
      const downloaded = await this.fileService.downloadFileToLocal(fileId);
      cleanup = downloaded.cleanup;

      const fileDocument = await loadFile(downloaded.filePath);
      let content = fileDocument.content || '';
      let status: ContextResourceResult['status'] = 'ready';
      const warnings: string[] = [];

      if (fileDocument.metadata?.error) {
        warnings.push(String(fileDocument.metadata.error));
        status = content ? 'partial' : 'failed';
      }

      if (isSheet) {
        const header =
          `Spreadsheet fileId=${fileId} name="${file.name}" size=${file.size ?? 0} (chat on-demand preview).\n` +
          `No long-lived Workbook assets. Upload via Resources for full lobe-workbook query.\n\n`;
        content = header + content;
        warnings.push(
          'Spreadsheet preview is budget-capped; upload via Resources for full structured query.',
        );
        status = 'partial';
      }

      if (content.length > cap) {
        content = `${content.slice(0, cap)}\n\n…[on-demand parse capped at ${cap} chars; upload via Resources for full indexing]`;
        status = 'partial';
        warnings.push(`Content truncated to ${cap} chars.`);
      }

      // Spreadsheets already use a hard char cap for preview; do not re-check raw
      // file size (xlsx often >200KB even when the extracted card is small).
      if (!isSheet && content && !shouldInlineParsedText({ content, size: file.size ?? 0 })) {
        content = `File id=${fileId} name="${file.name}" size=${file.size} is too large to inline (token budget). Upload via Resources for full indexing, or re-export a smaller extract. Cloud sandbox is not available — do not call lobe-cloud-sandbox.`;
        status = 'partial';
      }

      if (!content) {
        return {
          status: status === 'failed' ? 'failed' : 'unsupported',
          warnings: warnings.length
            ? warnings
            : [`File "${file.name}" produced no extractable text.`],
        };
      }

      return { content, status, warnings };
    } catch (error) {
      if (error instanceof UnsupportedFileTypeError) {
        return {
          content: `File id=${fileId} name="${file.name}" type=${fileType || 'unknown'} is not text-extractable. It remains available for download or specialized tools.`,
          status: 'unsupported',
          warnings: [error.message],
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      log('on-demand resolve failed for %s: %O', fileId, error);
      return {
        status: 'failed',
        warnings: [`File "${file.name}" could not be extracted: ${message}`],
      };
    } finally {
      cleanup?.();
    }
  };
}

export { ALL_FILE_CARDS_MAX_CHARS };
