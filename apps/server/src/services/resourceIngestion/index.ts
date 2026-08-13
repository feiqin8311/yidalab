import type { LobeChatDatabase } from '@lobechat/database';
import { isSpreadsheetFile } from '@lobechat/file-loaders';
import type { ResourcePersistReason } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { ChunkService } from '@/server/services/chunk';
import { WorkbookService } from '@/server/services/workbook';

const log = debug('lobe-resource:ingestion');

export interface RequestProcessingResult {
  fileId: string;
  processingPolicy: 'persistent';
  taskIds: {
    chunkTaskId?: string;
    workbookTaskId?: string;
  };
}

export type AddFilesToKnowledgeBaseResult = Awaited<
  ReturnType<KnowledgeBaseModel['addFilesToKnowledgeBase']>
>;

/**
 * Orchestrates long-lived resource processing (documents / chunks / workbook).
 *
 * Entry points: document import (createFile), KB link (`addFilesToKnowledgeBase`),
 * and explicit UI/API chunk actions. Resource page / KB uploads no longer call
 * this from createFile. Chat attachments stay on_demand and use
 * ContextResourceResolver at prompt time.
 *
 * KB link (Lambda / Agent runtime / OpenAPI) must go through
 * `addFilesToKnowledgeBase` so upgrade + ingestion stay one path.
 */
export class ResourceIngestionService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly fileModel: FileModel;
  private readonly knowledgeBaseModel: KnowledgeBaseModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.fileModel = new FileModel(db, userId, workspaceId);
    this.knowledgeBaseModel = new KnowledgeBaseModel(db, userId, workspaceId);
  }

  /**
   * Shared KB placement: atomic link + policy upgrade (model), then enqueue parse
   * for files that became persistent. Used by Lambda, Agent tool runtime, OpenAPI.
   */
  addFilesToKnowledgeBase = async (
    knowledgeBaseId: string,
    fileIds: string[],
    options?: { onConflict?: 'throw' | 'nothing' },
  ): Promise<AddFilesToKnowledgeBaseResult> => {
    const result = await this.knowledgeBaseModel.addFilesToKnowledgeBase(
      knowledgeBaseId,
      fileIds,
      options,
    );
    const upgradedFileIds = (result as { upgradedFileIds?: string[] }).upgradedFileIds ?? [];
    if (upgradedFileIds.length > 0) {
      await Promise.all(
        upgradedFileIds.map((fileId) => this.requestProcessingSafe(fileId, 'knowledge_base')),
      );
    }
    return result;
  };

  /**
   * Ensure persistent policy and start the appropriate processing pipeline.
   * Idempotent: re-calling reuses / re-enqueues safely.
   * Does not block on heavy parse — workers run async.
   */
  requestProcessing = async (
    fileId: string,
    reason: ResourcePersistReason = 'resource_upload',
  ): Promise<RequestProcessingResult> => {
    const file = await this.fileModel.findById(fileId);
    if (!file) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `File not found: ${fileId}` });
    }

    const alreadyPersistent =
      (file as { processingPolicy?: string }).processingPolicy === 'persistent';

    if (!alreadyPersistent) {
      await this.fileModel.update(fileId, {
        persistReason: reason,
        processingPolicy: 'persistent',
        processingRequestedAt: new Date(),
      } as any);
    }

    return this.enqueueProcessing(fileId, file);
  };

  /** Enqueue without throwing; mark parseStatus=failed when queueing fails. */
  private requestProcessingSafe = async (
    fileId: string,
    reason: ResourcePersistReason,
  ): Promise<void> => {
    try {
      await this.requestProcessing(fileId, reason);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log('ingestion failed file=%s: %O', fileId, e);
      console.error(`[ResourceIngestion] requestProcessing failed file=${fileId}:`, e);
      try {
        await this.fileModel.update(fileId, {
          parseError: `Ingestion enqueue failed: ${message}`,
          parseStatus: 'failed',
        } as any);
      } catch (updateError) {
        console.error(
          `[ResourceIngestion] failed to mark parseStatus after ingestion error file=${fileId}:`,
          updateError,
        );
      }
    }
  };

  private enqueueProcessing = async (
    fileId: string,
    file: { fileType: string; name: string },
  ): Promise<RequestProcessingResult> => {
    const taskIds: RequestProcessingResult['taskIds'] = {};

    if (isSpreadsheetFile(file.fileType, file.name)) {
      const workbookService = new WorkbookService(this.db, this.userId, this.workspaceId);
      const workbookTaskId = await workbookService.asyncEnqueueParse(fileId, true, {
        fileType: file.fileType,
        name: file.name,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      if (workbookTaskId) taskIds.workbookTaskId = workbookTaskId;
      log('enqueued workbook parse file=%s task=%s', fileId, workbookTaskId);
      return { fileId, processingPolicy: 'persistent', taskIds };
    }

    const isMedia =
      file.fileType.startsWith('image') ||
      file.fileType.startsWith('video') ||
      file.fileType.startsWith('audio');
    if (isMedia) {
      return { fileId, processingPolicy: 'persistent', taskIds };
    }

    // Chunk worker also materializes documents via DocumentService.parseFile.
    // Failures must surface so callers can mark parseStatus — do not swallow.
    const chunkService = new ChunkService(this.db, this.userId, this.workspaceId);
    const chunkTaskId = await chunkService.asyncParseFileToChunks(fileId, true);
    if (chunkTaskId) taskIds.chunkTaskId = chunkTaskId;
    log('enqueued chunk parse file=%s task=%s', fileId, chunkTaskId);

    return { fileId, processingPolicy: 'persistent', taskIds };
  };
}
