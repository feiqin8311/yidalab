import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearEphemeralWorkbookCache } from '../ephemeralCache';
import { WorkbookService } from '../index';

const mockFindById = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDownloadFileToLocal = vi.fn();
const mockBuildIsolated = vi.fn();

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    findById: mockFindById,
    update: mockUpdate,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({
    downloadFileToLocal: mockDownloadFileToLocal,
  })),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    create: vi.fn().mockResolvedValue('task-1'),
  })),
}));

vi.mock('@lobechat/file-loaders', () => ({
  ALL_FILE_CARDS_MAX_CHARS: 48_000,
  isSpreadsheetFile: () => true,
  WORKBOOK_PARSER_VERSION: 'test-v',
  buildWorkbookManifestCard: (build: any, meta: any) =>
    `card ${meta.fileId} sheets=${build.sheetCount}`,
  isDuckDBAvailable: () => false,
  buildWorkbookAssetsIsolated: (...args: unknown[]) => mockBuildIsolated(...args),
  queryJsonlSheet: (jsonl: string) => {
    const rows = jsonl
      ? jsonl
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
    return {
      nextCursor: undefined,
      returnedRows: rows.length,
      rows,
      scannedRows: rows.length,
      totalRows: rows.length,
      truncated: false,
    };
  },
  queryJsonlFile: vi.fn(),
  queryParquetFile: vi.fn(),
  jsonlFileToParquetBuffer: vi.fn(),
  jsonlToParquetBuffer: vi.fn(),
}));

describe('WorkbookService persistent gate + ephemeral', () => {
  let service: WorkbookService;

  beforeEach(() => {
    vi.clearAllMocks();
    clearEphemeralWorkbookCache();
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    mockSelect.mockReturnValue({ from });
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockDownloadFileToLocal.mockResolvedValue({
      cleanup: vi.fn(),
      filePath: '/tmp/fake.xlsx',
    });
    mockBuildIsolated.mockResolvedValue({
      coverage: { columnsCapped: false, sheetsCapped: false, sourceSheetCount: 1 },
      parserVersion: 'test-v',
      sheetCount: 1,
      sheets: [
        {
          columnCount: 2,
          columns: ['花费', 'ROAS'],
          jsonl: `${JSON.stringify({ ROAS: '2', 花费: '100' })}\n${JSON.stringify({ ROAS: '3', 花费: '200' })}`,
          rowCount: 2,
          sampleRows: [{ ROAS: '2', 花费: '100' }],
          sheetIndex: 0,
          sheetName: 'Sheet1',
        },
      ],
      totalJsonlBytes: 50,
      totalRows: 2,
      unrestrictedTokenEstimate: 10,
    });
    service = new WorkbookService({ select: mockSelect, insert: mockInsert } as any, 'user-1');
  });

  it('inspectWorkbook on on_demand builds ephemeral ready card (not unsupported)', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-on',
      name: 'chat.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileHash: 'hash-1',
      processingPolicy: 'on_demand',
      size: 1024,
      userId: 'user-1',
    });

    const result = await service.inspectWorkbook('f-on');

    expect(result.parseStatus).toBe('ready');
    expect((result as any).ephemeral).toBe(true);
    expect(result.promptCard).toMatch(/ephemeral|f-on|sheets=1/i);
    expect(mockBuildIsolated).toHaveBeenCalled();
    // Must not enqueue persistent parse
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('asyncEnqueueParse still no-ops for non-persistent files', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-on',
      name: 'chat.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      processingPolicy: 'on_demand',
      userId: 'user-1',
    });

    const taskId = await service.asyncEnqueueParse('f-on');
    expect(taskId).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('querySheet on on_demand uses ephemeral workbook without enqueue', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-on',
      name: 'chat.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileHash: 'hash-1',
      processingPolicy: 'on_demand',
      size: 1024,
      userId: 'user-1',
    });

    const result = await service.querySheet({ fileId: 'f-on', sheet: 'Sheet1' });
    expect(result.rows).toHaveLength(2);
    expect((result as any).ephemeral).toBe(true);
    expect((result as any).columns).toEqual(['花费', 'ROAS']);
    expect(result.hasMore).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('querySheet ephemeral reuses cache (second call no re-download)', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-on',
      name: 'chat.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileHash: 'hash-1',
      processingPolicy: 'on_demand',
      size: 1024,
      userId: 'user-1',
    });

    await service.querySheet({ fileId: 'f-on', sheet: 'Sheet1' });
    await service.querySheet({ fileId: 'f-on', sheet: 'Sheet1' });
    expect(mockDownloadFileToLocal).toHaveBeenCalledTimes(1);
    expect(mockBuildIsolated).toHaveBeenCalledTimes(1);
  });
});
