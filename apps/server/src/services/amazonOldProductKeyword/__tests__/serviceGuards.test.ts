/**
 * Service guard unit tests with mocked run model / file service.
 * Covers ASIN conflict on retry and conditional export claim release.
 */
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AmazonOldProductKeywordService } from '../index';

const findById = vi.fn();
const findActiveByAsin = vi.fn();
const update = vi.fn();
const claimExport = vi.fn();
const releaseExportClaim = vi.fn();

vi.mock('@/database/models/businessFunction', () => ({
  BusinessFunctionRunModel: class {
    findById = findById;
    findActiveByAsin = findActiveByAsin;
    update = update;
    claimExport = claimExport;
    releaseExportClaim = releaseExportClaim;
    findByIdUnscoped = vi.fn();
    updateById = vi.fn();
    query = vi.fn();
    count = vi.fn();
    create = vi.fn();
    delete = vi.fn();
    requestCancel = vi.fn();
    isCancelRequested = vi.fn();
  },
  BusinessFunctionResultRowModel: class {
    query = vi.fn();
    deleteByRunId = vi.fn();
    listAllForView = vi.fn();
    upsertBatchAs = vi.fn();
    deleteByRunIdUnscoped = vi.fn();
  },
}));

vi.mock('@/server/services/file', () => ({
  FileService: class {
    createPreSignedUrl = vi.fn();
    getFileMetadata = vi.fn();
    deleteFile = vi.fn();
    deleteFiles = vi.fn();
    deleteByPrefix = vi.fn();
    getFileByteArray = vi.fn();
    uploadBuffer = vi.fn();
    createPreSignedUrlForPreview = vi.fn();
  },
}));

const baseRun = {
  id: 'bfr_old',
  functionType: 'amazon-old-product-keyword-analysis',
  status: 'failed',
  stage: 'ai_keyword_batches',
  mainAsin: 'B0CH9V3V35',
  config: {
    mainAsin: 'B0CH9V3V35',
    categoryName: '儿童剪刀',
    priceUsd: 12,
    thresholds: {},
    model: { provider: 'openai', model: 'gpt' },
    sourceManifest: {},
  },
  progress: { stage: 'ai_keyword_batches', percent: 50 },
  exportInfo: { status: 'idle' },
};

describe('AmazonOldProductKeywordService guards', () => {
  let service: AmazonOldProductKeywordService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AmazonOldProductKeywordService({} as any, 'user-1', 'ws-1');
  });

  describe('retry', () => {
    it('rejects when another active run exists for same ASIN', async () => {
      findById.mockResolvedValue(baseRun);
      findActiveByAsin.mockResolvedValue({ id: 'bfr_new', status: 'running' });

      await expect(service.retry('bfr_old')).rejects.toBeInstanceOf(TRPCError);
      await expect(service.retry('bfr_old')).rejects.toMatchObject({
        message: expect.stringContaining('ACTIVE_RUN_EXISTS:bfr_new'),
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('queues when no active sibling', async () => {
      findById.mockResolvedValue(baseRun);
      findActiveByAsin.mockResolvedValue(undefined);
      update.mockResolvedValue({ ...baseRun, status: 'queued' });

      const result = await service.retry('bfr_old');
      expect(result.status).toBe('queued');
      expect(findActiveByAsin).toHaveBeenCalledWith(
        'amazon-old-product-keyword-analysis',
        'B0CH9V3V35',
        'bfr_old',
      );
    });
  });

  describe('requestExport / releaseExportClaim', () => {
    it('claims only via atomic claimExport', async () => {
      findById.mockResolvedValue({
        ...baseRun,
        status: 'succeeded',
        exportInfo: { status: 'idle' },
      });
      claimExport.mockResolvedValue({
        ...baseRun,
        status: 'exporting',
        exportInfo: { status: 'pending' },
      });

      const { claimed, run } = await service.requestExport('bfr_old');
      expect(claimed).toBe(true);
      expect(run.exportInfo?.status).toBe('pending');
      expect(claimExport).toHaveBeenCalledWith('bfr_old');
    });

    it('does not claim when already pending', async () => {
      findById.mockResolvedValue({
        ...baseRun,
        status: 'exporting',
        exportInfo: { status: 'pending' },
      });

      const { claimed } = await service.requestExport('bfr_old');
      expect(claimed).toBe(false);
      expect(claimExport).not.toHaveBeenCalled();
    });

    it('releaseExportClaim delegates to conditional model method', async () => {
      releaseExportClaim.mockResolvedValue({
        ...baseRun,
        status: 'succeeded',
        exportInfo: { status: 'failed', error: 'timeout' },
      });

      const result = await service.releaseExportClaim('bfr_old', 'timeout');
      expect(releaseExportClaim).toHaveBeenCalledWith('bfr_old', 'timeout');
      expect(result?.exportInfo?.status).toBe('failed');
    });

    it('releaseExportClaim returns undefined when status left pending (workflow already running)', async () => {
      releaseExportClaim.mockResolvedValue(undefined);
      const result = await service.releaseExportClaim('bfr_old', 'timeout');
      expect(result).toBeUndefined();
    });
  });

  describe('markDispatchFailed', () => {
    it('rolls queued back to draft on fresh start', async () => {
      findById.mockResolvedValue({
        ...baseRun,
        status: 'queued',
        stage: 'parse_sources',
        error: null,
        progress: { stage: 'parse_sources', percent: 12 },
      });
      update.mockResolvedValue({ ...baseRun, status: 'draft' });

      await service.markDispatchFailed('bfr_old', 'qstash down');
      expect(update).toHaveBeenCalledWith(
        'bfr_old',
        expect.objectContaining({
          status: 'draft',
          error: expect.objectContaining({ code: 'WORKFLOW_DISPATCH_FAILED' }),
        }),
      );
    });

    it('rolls queued back to failed on resume mid-pipeline', async () => {
      findById.mockResolvedValue({
        ...baseRun,
        status: 'queued',
        stage: 'ai_keyword_batches',
        error: { code: 'PREV' },
        progress: { stage: 'ai_keyword_batches', percent: 50 },
      });
      update.mockResolvedValue({ ...baseRun, status: 'failed' });

      await service.markDispatchFailed('bfr_old', 'qstash down');
      expect(update).toHaveBeenCalledWith('bfr_old', expect.objectContaining({ status: 'failed' }));
    });
  });
});
