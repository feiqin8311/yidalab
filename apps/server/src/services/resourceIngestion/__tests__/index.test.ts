import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourceIngestionService } from '../index';

const mockFindById = vi.fn();
const mockUpdate = vi.fn();
const mockAsyncEnqueueParse = vi.fn();
const mockAsyncParseFileToChunks = vi.fn();
const mockIsSpreadsheetFile = vi.fn();
const mockAddFilesToKnowledgeBase = vi.fn();

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    findById: mockFindById,
    update: mockUpdate,
  })),
}));

vi.mock('@/database/models/knowledgeBase', () => ({
  KnowledgeBaseModel: vi.fn(() => ({
    addFilesToKnowledgeBase: mockAddFilesToKnowledgeBase,
  })),
}));

vi.mock('@/server/services/workbook', () => ({
  WorkbookService: vi.fn(() => ({
    asyncEnqueueParse: mockAsyncEnqueueParse,
  })),
}));

vi.mock('@/server/services/chunk', () => ({
  ChunkService: vi.fn(() => ({
    asyncParseFileToChunks: mockAsyncParseFileToChunks,
  })),
}));

vi.mock('@lobechat/file-loaders', () => ({
  isSpreadsheetFile: (...args: unknown[]) => mockIsSpreadsheetFile(...args),
}));

describe('ResourceIngestionService', () => {
  let service: ResourceIngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ResourceIngestionService({} as any, 'user-1');
    mockIsSpreadsheetFile.mockReturnValue(false);
    mockUpdate.mockResolvedValue(undefined);
    mockAsyncParseFileToChunks.mockResolvedValue('chunk-task-1');
    mockAsyncEnqueueParse.mockResolvedValue('wb-task-1');
    mockAddFilesToKnowledgeBase.mockResolvedValue(
      Object.assign([], { upgradedFileIds: [] as string[] }),
    );
  });

  it('requestProcessing upgrades policy and enqueues chunk for documents', async () => {
    mockFindById.mockResolvedValue({
      id: 'f1',
      name: 'a.pdf',
      fileType: 'application/pdf',
      processingPolicy: 'on_demand',
    });

    const result = await service.requestProcessing('f1', 'resource_upload');

    expect(mockUpdate).toHaveBeenCalledWith(
      'f1',
      expect.objectContaining({
        processingPolicy: 'persistent',
        persistReason: 'resource_upload',
      }),
    );
    expect(mockAsyncParseFileToChunks).toHaveBeenCalledWith('f1', true);
    expect(mockAsyncEnqueueParse).not.toHaveBeenCalled();
    expect(result.processingPolicy).toBe('persistent');
    expect(result.taskIds.chunkTaskId).toBe('chunk-task-1');
  });

  it('requestProcessing surfaces chunk enqueue failures', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-fail',
      name: 'a.pdf',
      fileType: 'application/pdf',
      processingPolicy: 'persistent',
    });
    mockAsyncParseFileToChunks.mockRejectedValue(new Error('queue down'));

    await expect(service.requestProcessing('f-fail')).rejects.toThrow('queue down');
  });

  it('requestProcessing on spreadsheet enqueues workbook only', async () => {
    mockIsSpreadsheetFile.mockReturnValue(true);
    mockFindById.mockResolvedValue({
      id: 'f2',
      name: 'a.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      processingPolicy: 'persistent',
    });

    const result = await service.requestProcessing('f2', 'resource_upload');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAsyncEnqueueParse).toHaveBeenCalled();
    expect(mockAsyncParseFileToChunks).not.toHaveBeenCalled();
    expect(result.taskIds.workbookTaskId).toBe('wb-task-1');
  });

  it('skips content pipeline for media', async () => {
    mockFindById.mockResolvedValue({
      id: 'f3',
      name: 'a.png',
      fileType: 'image/png',
      processingPolicy: 'persistent',
    });

    const result = await service.requestProcessing('f3');

    expect(mockAsyncParseFileToChunks).not.toHaveBeenCalled();
    expect(mockAsyncEnqueueParse).not.toHaveBeenCalled();
    expect(result.taskIds).toEqual({});
  });

  it('throws NOT_FOUND for missing file', async () => {
    mockFindById.mockResolvedValue(undefined);

    await expect(service.requestProcessing('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('addFilesToKnowledgeBase links then enqueues upgraded files', async () => {
    mockAddFilesToKnowledgeBase.mockResolvedValue(
      Object.assign([{ fileId: 'up-1' }], { upgradedFileIds: ['up-1'] }),
    );
    mockFindById.mockResolvedValue({
      id: 'up-1',
      name: 'a.pdf',
      fileType: 'application/pdf',
      processingPolicy: 'persistent',
    });

    const result = await service.addFilesToKnowledgeBase('kb-1', ['up-1']);

    expect(mockAddFilesToKnowledgeBase).toHaveBeenCalledWith('kb-1', ['up-1'], undefined);
    expect(mockAsyncParseFileToChunks).toHaveBeenCalledWith('up-1', true);
    expect(result).toHaveLength(1);
  });

  it('addFilesToKnowledgeBase marks parseStatus=failed when enqueue fails', async () => {
    mockAddFilesToKnowledgeBase.mockResolvedValue(
      Object.assign([{ fileId: 'up-fail' }], { upgradedFileIds: ['up-fail'] }),
    );
    mockFindById.mockResolvedValue({
      id: 'up-fail',
      name: 'a.pdf',
      fileType: 'application/pdf',
      processingPolicy: 'persistent',
    });
    mockAsyncParseFileToChunks.mockRejectedValue(new Error('queue down'));

    await service.addFilesToKnowledgeBase('kb-1', ['up-fail']);

    expect(mockUpdate).toHaveBeenCalledWith(
      'up-fail',
      expect.objectContaining({
        parseStatus: 'failed',
        parseError: expect.stringContaining('queue down'),
      }),
    );
  });

  it('addFilesToKnowledgeBase skips ingestion when nothing upgraded', async () => {
    mockAddFilesToKnowledgeBase.mockResolvedValue(
      Object.assign([{ fileId: 'p1' }], { upgradedFileIds: [] }),
    );

    await service.addFilesToKnowledgeBase('kb-1', ['p1'], { onConflict: 'nothing' });

    expect(mockAddFilesToKnowledgeBase).toHaveBeenCalledWith('kb-1', ['p1'], {
      onConflict: 'nothing',
    });
    expect(mockAsyncParseFileToChunks).not.toHaveBeenCalled();
  });
});
