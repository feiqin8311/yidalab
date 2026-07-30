import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  type FileParseStatus,
  files,
  type FileSheetAssetItem,
  fileSheetAssets,
  type FileWorkbookItem,
  type FileWorkbookManifest,
  fileWorkbooks,
} from '@lobechat/database/schemas';
import {
  ALL_FILE_CARDS_MAX_CHARS,
  buildWorkbookAssetsFromPath,
  buildWorkbookManifestCard,
  isSpreadsheetFile,
  queryJsonlSheet,
  type SheetQueryFilter,
  type SheetQueryInput,
  WORKBOOK_INLINE_JSONL_MAX_BYTES,
  WORKBOOK_PARSER_VERSION,
} from '@lobechat/file-loaders';
import debug from 'debug';
import { and, eq, lt, or } from 'drizzle-orm';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { FileService } from '@/server/services/file';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

const log = debug('lobe-server:workbook');

/** Stale parsing lease — allow reclaim after this many ms. */
const PARSE_LEASE_MS = 5 * 60 * 1000;
/** Cool-down after failed parse before auto-retry. */
const FAIL_COOLDOWN_MS = 2 * 60 * 1000;

export interface WorkbookQueryArgs extends SheetQueryInput {
  fileId: string;
  sheet: string;
}

/**
 * Workbook derived assets are scoped to the **file owner** (and fileId),
 * not the caller who first triggered parse.
 */
export class WorkbookService {
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

  private ownershipFile = async (fileId: string) => {
    const file = await this.fileModel.findById(fileId);
    if (!file) throw new Error(`File not found: ${fileId}`);
    return file;
  };

  private ownerUserId = (file: { userId: string }) => file.userId;

  getReadyWorkbook = async (fileId: string): Promise<FileWorkbookItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(fileWorkbooks)
      .where(
        and(
          eq(fileWorkbooks.fileId, fileId),
          eq(fileWorkbooks.parserVersion, WORKBOOK_PARSER_VERSION),
        ),
      )
      .limit(1);
    return row;
  };

  listSheetAssets = async (fileId: string): Promise<FileSheetAssetItem[]> => {
    const workbook = await this.getReadyWorkbook(fileId);
    if (!workbook || workbook.status !== 'ready') return [];
    if (workbook.generationId) {
      return this.db
        .select()
        .from(fileSheetAssets)
        .where(
          and(
            eq(fileSheetAssets.workbookId, workbook.id),
            eq(fileSheetAssets.generationId, workbook.generationId),
          ),
        );
    }
    return this.db
      .select()
      .from(fileSheetAssets)
      .where(eq(fileSheetAssets.workbookId, workbook.id));
  };

  private cardFromWorkbook = (
    workbook: FileWorkbookItem,
    file: { id: string; name: string; size: number },
  ) => {
    const manifest = workbook.manifest;
    if (!manifest) return '';
    return buildWorkbookManifestCard(
      {
        coverage: {
          columnsCapped: Boolean(manifest.coverage?.columnsCapped),
          sheetsCapped: Boolean(manifest.coverage?.sheetsCapped),
          sourceSheetCount: manifest.coverage?.sourceSheetCount ?? workbook.sheetCount,
        },
        parserVersion: workbook.parserVersion,
        sheetCount: workbook.sheetCount,
        sheets: (manifest.sheets || []).map((s) => ({
          columnCount: s.columnCount,
          columns: s.columns,
          jsonl: '',
          rowCount: s.rowCount,
          sampleRows: s.sampleRows,
          sheetIndex: s.sheetIndex,
          sheetName: s.name,
        })),
        totalJsonlBytes: 0,
        totalRows: workbook.totalRows,
        unrestrictedTokenEstimate: workbook.tokenEstimate ?? 0,
      },
      { fileId: file.id, fileName: file.name, size: file.size },
    );
  };

  /**
   * Atomic-ish claim: only one parser may own status=parsing at a time.
   * Reclaim if lease (updated_at) is stale. Returns undefined if another worker holds the lease.
   */
  private claimParse = async (args: {
    /** Allow stealing ready only when assets incomplete. */
    allowReady?: boolean;
    assetWorkspaceId?: string;
    fileId: string;
    ownerId: string;
  }): Promise<FileWorkbookItem | undefined> => {
    const leaseCutoff = new Date(Date.now() - PARSE_LEASE_MS);

    // Insert if missing
    await this.db
      .insert(fileWorkbooks)
      .values({
        fileId: args.fileId,
        parserVersion: WORKBOOK_PARSER_VERSION,
        sheetCount: 0,
        status: 'uploaded',
        totalRows: 0,
        userId: args.ownerId,
        workspaceId: args.assetWorkspaceId,
      })
      .onConflictDoNothing({
        target: [fileWorkbooks.fileId, fileWorkbooks.parserVersion],
      });

    // Claim: transition to parsing only from non-busy states or stale parsing/failed-after-cooldown.
    const failCutoff = new Date(Date.now() - FAIL_COOLDOWN_MS);
    const statusOk = args.allowReady
      ? or(
          eq(fileWorkbooks.status, 'uploaded'),
          eq(fileWorkbooks.status, 'queued'),
          eq(fileWorkbooks.status, 'ready'),
          and(eq(fileWorkbooks.status, 'failed'), lt(fileWorkbooks.updatedAt, failCutoff)),
          and(eq(fileWorkbooks.status, 'parsing'), lt(fileWorkbooks.updatedAt, leaseCutoff)),
        )
      : or(
          eq(fileWorkbooks.status, 'uploaded'),
          eq(fileWorkbooks.status, 'queued'),
          and(eq(fileWorkbooks.status, 'failed'), lt(fileWorkbooks.updatedAt, failCutoff)),
          and(eq(fileWorkbooks.status, 'parsing'), lt(fileWorkbooks.updatedAt, leaseCutoff)),
        );

    const generationId = randomUUID();
    const [claimed] = await this.db
      .update(fileWorkbooks)
      .set({
        error: null,
        generationId,
        status: 'parsing',
        updatedAt: new Date(),
        userId: args.ownerId,
        workspaceId: args.assetWorkspaceId,
      })
      .where(
        and(
          eq(fileWorkbooks.fileId, args.fileId),
          eq(fileWorkbooks.parserVersion, WORKBOOK_PARSER_VERSION),
          statusOk,
        ),
      )
      .returning();

    return claimed;
  };

  /**
   * Upload-path enqueue: set files.parse_status=queued + async_tasks FileParse,
   * fire-and-forget HTTP async worker (same pattern as chunk).
   * Does NOT parse on the request thread.
   */
  asyncEnqueueParse = async (
    fileId: string,
    skipExist = true,
    known?: { fileType?: string; name?: string; userId?: string; workspaceId?: string | null },
  ): Promise<string | undefined> => {
    // Prefer caller-provided meta (upload path) to avoid extra access-control joins.
    const file =
      known?.fileType && known?.name
        ? {
            fileType: known.fileType,
            name: known.name,
            parseStatus: undefined as string | undefined,
            parseTaskId: null as string | null,
            userId: known.userId || this.userId,
            workspaceId: known.workspaceId ?? this.workspaceId,
          }
        : await this.fileModel.findById(fileId);
    if (!file) return;
    if (!isSpreadsheetFile(file.fileType, file.name)) return;
    if (
      skipExist &&
      (file.parseStatus === 'ready' ||
        file.parseStatus === 'queued' ||
        file.parseStatus === 'parsing')
    ) {
      return file.parseTaskId ?? undefined;
    }

    const ownerId = file.userId;
    const assetWorkspaceId = file.workspaceId ?? this.workspaceId ?? undefined;
    const asyncTaskModel = new AsyncTaskModel(this.db, this.userId, this.workspaceId);
    const asyncTaskId = await asyncTaskModel.create({
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.FileParse,
    });

    await this.fileModel.update(fileId, {
      parseError: null,
      parseStatus: 'queued',
      parseTaskId: asyncTaskId,
    });

    await this.db
      .insert(fileWorkbooks)
      .values({
        fileId,
        parserVersion: WORKBOOK_PARSER_VERSION,
        sheetCount: 0,
        status: 'queued',
        totalRows: 0,
        userId: ownerId,
        workspaceId: assetWorkspaceId,
      })
      .onConflictDoUpdate({
        set: {
          error: null,
          status: 'queued',
          updatedAt: new Date(),
        },
        target: [fileWorkbooks.fileId, fileWorkbooks.parserVersion],
      });

    // Dynamic import: avoid static cycle with async router (same as ChunkService).
    const { createAsyncCaller } = await import('@/server/routers/async');
    const asyncCaller = await createAsyncCaller({ userId: this.userId });
    asyncCaller.file
      .parseWorkbook({ fileId, taskId: asyncTaskId, workspaceId: this.workspaceId })
      .catch(async (e) => {
        log('enqueue parseWorkbook failed: %O', e);
        await asyncTaskModel.update(asyncTaskId, {
          error: new AsyncTaskError(
            AsyncTaskErrorType.TaskTriggerError,
            'trigger workbook parse async task error. Check APP_URL / internal JWT.',
          ),
          status: AsyncTaskStatus.Error,
        });
        await this.fileModel.update(fileId, {
          parseError: 'Failed to trigger parse worker',
          parseStatus: 'failed',
        });
      });

    return asyncTaskId;
  };

  /**
   * Parse spreadsheet once. Idempotent for (fileId, parserVersion).
   * Concurrent callers: only the claim winner parses; others wait or return ready.
   */
  parseWorkbookFile = async (
    fileId: string,
  ): Promise<{ card: string; status: FileParseStatus; workbookId?: string }> => {
    const file = await this.ownershipFile(fileId);
    const ownerId = this.ownerUserId(file);
    const assetWorkspaceId = file.workspaceId ?? this.workspaceId ?? undefined;

    if (!isSpreadsheetFile(file.fileType, file.name)) {
      await this.fileModel.update(fileId, {
        parseError: 'Not a spreadsheet',
        parseStatus: 'unsupported',
      });
      return { card: '', status: 'unsupported' };
    }

    const existing = await this.getReadyWorkbook(fileId);
    if (existing?.status === 'ready' && existing.manifest) {
      const assets = await this.listSheetAssets(fileId);
      if (assets.length >= (existing.sheetCount || 0) || existing.sheetCount === 0) {
        return {
          card: this.cardFromWorkbook(existing, file),
          status: 'ready',
          workbookId: existing.id,
        };
      }
    }

    // Another parse in progress with fresh lease — do not fight it.
    if (existing?.status === 'parsing') {
      const age = Date.now() - new Date(existing.updatedAt).getTime();
      if (age < PARSE_LEASE_MS) {
        return {
          card: existing.manifest
            ? this.cardFromWorkbook(existing, file)
            : `Spreadsheet "${file.name}" is parsing. Retry inspectWorkbook shortly.`,
          status: 'parsing',
          workbookId: existing.id,
        };
      }
    }

    // Failed recently — circuit break (no tight retry loop).
    if (existing?.status === 'failed') {
      const age = Date.now() - new Date(existing.updatedAt).getTime();
      if (age < FAIL_COOLDOWN_MS) {
        throw new Error(
          existing.error ||
            `Workbook parse failed recently; retry after ${Math.ceil((FAIL_COOLDOWN_MS - age) / 1000)}s`,
        );
      }
    }

    // Incomplete ready (assets missing) must re-claim; complete ready already returned above.
    const forceReparseIncompleteReady =
      existing?.status === 'ready' &&
      existing.manifest &&
      (await this.listSheetAssets(fileId)).length < (existing.sheetCount || 0);

    await this.fileModel.update(fileId, { parseError: null, parseStatus: 'parsing' });

    const claimed = await this.claimParse({
      allowReady: forceReparseIncompleteReady,
      assetWorkspaceId,
      fileId,
      ownerId,
    });
    if (!claimed) {
      // Lost race — re-read and return current state without deleting assets.
      const current = await this.getReadyWorkbook(fileId);
      if (current?.status === 'ready' && current.manifest) {
        return {
          card: this.cardFromWorkbook(current, file),
          status: 'ready',
          workbookId: current.id,
        };
      }
      return {
        card: `Spreadsheet "${file.name}" is being parsed by another worker. Retry inspectWorkbook shortly.`,
        status: (current?.status as FileParseStatus) || 'parsing',
        workbookId: current?.id,
      };
    }

    const workbookId = claimed.id;
    const generationId = claimed.generationId || randomUUID();
    const { cleanup, filePath } = await this.fileService.downloadFileToLocal(fileId);
    const uploadedKeys: string[] = [];

    try {
      const build = await buildWorkbookAssetsFromPath(filePath);
      const manifest: FileWorkbookManifest = {
        coverage: build.coverage,
        fileName: file.name,
        parserVersion: build.parserVersion,
        sheetCount: build.sheetCount,
        sheets: build.sheets.map((s) => ({
          columnCount: s.columnCount,
          columns: s.columns,
          name: s.sheetName,
          rowCount: s.rowCount,
          sampleRows: s.sampleRows,
          sheetIndex: s.sheetIndex,
        })),
        totalRows: build.totalRows,
        unrestrictedTokenEstimate: build.unrestrictedTokenEstimate,
      };

      // Heartbeat lease before heavy S3 / asset writes (must still own generation).
      const [heartbeat] = await this.db
        .update(fileWorkbooks)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(fileWorkbooks.id, workbookId),
            eq(fileWorkbooks.status, 'parsing'),
            eq(fileWorkbooks.generationId, generationId),
          ),
        )
        .returning();
      if (!heartbeat) {
        const current = await this.getReadyWorkbook(fileId);
        return {
          card: current?.manifest
            ? this.cardFromWorkbook(current, file)
            : `Spreadsheet "${file.name}" parse superseded.`,
          status: (current?.status as FileParseStatus) || 'parsing',
          workbookId: current?.id,
        };
      }

      // Double-buffer: write new generation assets first, then swap; delete previous generation after ready.
      const previousAssets = await this.db
        .select()
        .from(fileSheetAssets)
        .where(eq(fileSheetAssets.workbookId, workbookId));

      for (const sheet of build.sheets) {
        const jsonlBytes = Buffer.byteLength(sheet.jsonl, 'utf8');
        let storageKey: string | null = null;
        let inlineJsonl: string | null = null;
        // format: jsonl today; parquet reserved when sheet exceeds platform (see notes).
        const format = 'jsonl' as const;
        if (jsonlBytes <= WORKBOOK_INLINE_JSONL_MAX_BYTES) {
          inlineJsonl = sheet.jsonl;
        } else {
          storageKey = `workbooks/${ownerId}/${fileId}/${generationId}/${sheet.sheetIndex}.jsonl`;
          await this.fileService.uploadBuffer(
            storageKey,
            Buffer.from(sheet.jsonl, 'utf8'),
            'application/x-ndjson',
          );
          uploadedKeys.push(storageKey);
        }

        await this.db.insert(fileSheetAssets).values({
          columnCount: sheet.columnCount,
          columns: sheet.columns.map((name) => ({ name })),
          fileId,
          format,
          generationId,
          inlineJsonl,
          rowCount: sheet.rowCount,
          sheetIndex: sheet.sheetIndex,
          sheetName: sheet.sheetName,
          storageKey,
          userId: ownerId,
          workbookId,
          workspaceId: assetWorkspaceId,
        });
      }

      // Publish ready only for this generation while still parsing.
      const [published] = await this.db
        .update(fileWorkbooks)
        .set({
          error: null,
          generationId,
          manifest,
          sheetCount: build.sheetCount,
          status: 'ready',
          tokenEstimate: build.unrestrictedTokenEstimate,
          totalRows: build.totalRows,
          updatedAt: new Date(),
          userId: ownerId,
          workspaceId: assetWorkspaceId,
        })
        .where(
          and(
            eq(fileWorkbooks.id, workbookId),
            eq(fileWorkbooks.status, 'parsing'),
            eq(fileWorkbooks.generationId, generationId),
          ),
        )
        .returning();

      if (!published) {
        for (const key of uploadedKeys) {
          try {
            await this.fileService.deleteFile(key);
          } catch {
            /* ignore */
          }
        }
        // Drop orphan new-generation rows
        await this.db
          .delete(fileSheetAssets)
          .where(
            and(
              eq(fileSheetAssets.workbookId, workbookId),
              eq(fileSheetAssets.generationId, generationId),
            ),
          );
        throw new Error('Lost parse lease before publish');
      }

      // Cleanup previous generation assets (keep current generationId).
      for (const prev of previousAssets) {
        if (prev.generationId === generationId) continue;
        if (prev.storageKey) {
          try {
            await this.fileService.deleteFile(prev.storageKey);
          } catch (e) {
            log('cleanup old asset key failed %s: %O', prev.storageKey, e);
          }
        }
        await this.db.delete(fileSheetAssets).where(eq(fileSheetAssets.id, prev.id));
      }

      const card = buildWorkbookManifestCard(build, {
        fileId: file.id,
        fileName: file.name,
        size: file.size,
      });

      await this.fileModel.update(fileId, {
        parseError: null,
        parseStatus: 'ready',
        parsedAt: new Date(),
        parserVersion: WORKBOOK_PARSER_VERSION,
      });

      log('parsed workbook fileId=%s sheets=%d rows=%d', fileId, build.sheetCount, build.totalRows);
      return { card, status: 'ready', workbookId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('parse failed fileId=%s: %s', fileId, message);

      for (const key of uploadedKeys) {
        try {
          await this.fileService.deleteFile(key);
        } catch {
          /* ignore */
        }
      }

      await this.fileModel.update(fileId, {
        parseError: message.slice(0, 2000),
        parseStatus: 'failed',
      });
      await this.db
        .update(fileWorkbooks)
        .set({
          error: message.slice(0, 2000),
          status: 'failed',
          updatedAt: new Date(),
        })
        .where(and(eq(fileWorkbooks.id, workbookId), eq(fileWorkbooks.status, 'parsing')));
      throw error;
    } finally {
      cleanup();
    }
  };

  private loadSheetJsonl = async (asset: FileSheetAssetItem): Promise<string> => {
    if (asset.format === 'parquet') {
      // Parquet + DuckDB path not installed yet — fail clearly rather than hang.
      throw new Error(
        'Sheet is stored as parquet; DuckDB query path not enabled in this deployment. Re-parse with jsonl or enable duckdb worker.',
      );
    }
    if (asset.inlineJsonl != null) return asset.inlineJsonl;
    if (!asset.storageKey) return '';
    // ponytail: full JSONL load — upgrade large sheets to parquet/DuckDB.
    return this.fileService.getFileContent(asset.storageKey);
  };

  /**
   * Inspect for prompt/tools. Never blocks on full parse when queued/parsing —
   * returns a status card and relies on async worker (or caller enqueue).
   */
  inspectWorkbook = async (fileId: string) => {
    const file = await this.ownershipFile(fileId);
    let workbook = await this.getReadyWorkbook(fileId);

    if (workbook?.status === 'ready' && workbook.manifest) {
      const card = this.cardFromWorkbook(workbook, file);
      return {
        fileId,
        fileVersion: workbook.parserVersion,
        generationId: workbook.generationId ?? undefined,
        manifest: workbook.manifest,
        parseStatus: workbook.status,
        promptCard: card.slice(0, ALL_FILE_CARDS_MAX_CHARS),
      };
    }

    // Ensure a job exists for uploaded/failed-old/missing rows.
    if (
      !workbook ||
      workbook.status === 'uploaded' ||
      (workbook.status === 'failed' &&
        Date.now() - new Date(workbook.updatedAt).getTime() >= FAIL_COOLDOWN_MS)
    ) {
      await this.asyncEnqueueParse(fileId, false);
      workbook = await this.getReadyWorkbook(fileId);
    }

    const status = (workbook?.status as FileParseStatus) || 'queued';
    const promptCard =
      `Spreadsheet fileId=${fileId} name="${file.name}" parseStatus=${status}. ` +
      `Full grid is NOT inlined. Wait for parse ready, then use lobe-workbook querySheet. ` +
      (workbook?.error ? `Last error: ${workbook.error}` : '');

    return {
      fileId,
      fileVersion: WORKBOOK_PARSER_VERSION,
      generationId: workbook?.generationId ?? undefined,
      manifest: workbook?.manifest,
      parseStatus: status,
      promptCard: promptCard.slice(0, ALL_FILE_CARDS_MAX_CHARS),
    };
  };

  querySheet = async (args: WorkbookQueryArgs) => {
    await this.ownershipFile(args.fileId);
    const assets = await this.listSheetAssets(args.fileId);
    const asset =
      assets.find((a) => a.sheetName === args.sheet) ||
      assets.find((a) => String(a.sheetIndex) === args.sheet);
    if (!asset) {
      await this.parseWorkbookFile(args.fileId);
      const again = await this.listSheetAssets(args.fileId);
      const hit =
        again.find((a) => a.sheetName === args.sheet) ||
        again.find((a) => String(a.sheetIndex) === args.sheet);
      if (!hit) throw new Error(`Sheet not found: ${args.sheet}`);
      return this.querySheetOnAsset(hit, args);
    }
    return this.querySheetOnAsset(asset, args);
  };

  private querySheetOnAsset = async (asset: FileSheetAssetItem, args: WorkbookQueryArgs) => {
    const jsonl = await this.loadSheetJsonl(asset);
    const result = queryJsonlSheet(jsonl, {
      columns: args.columns,
      cursor: args.cursor,
      filters: args.filters as SheetQueryFilter[] | undefined,
      limit: args.limit,
      orderBy: args.orderBy,
    });
    return {
      ...result,
      source: {
        fileId: asset.fileId,
        fileVersion: WORKBOOK_PARSER_VERSION,
        format: asset.format ?? 'jsonl',
        generationId: asset.generationId ?? undefined,
        sheet: asset.sheetName,
      },
    };
  };

  previewSheet = async (fileId: string, sheet: string, limit = 20) => {
    return this.querySheet({ fileId, limit, sheet });
  };

  static async markUploaded(db: LobeChatDatabase, fileId: string, userId: string) {
    await db
      .update(files)
      .set({ parseStatus: 'uploaded', updatedAt: new Date() })
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));
  }
}
