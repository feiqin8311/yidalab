import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkbookService } from '../index';

const mockFindById = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    findById: mockFindById,
    update: mockUpdate,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({})),
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
  buildWorkbookManifestCard: vi.fn(),
  isDuckDBAvailable: () => false,
}));

describe('WorkbookService persistent gate', () => {
  let service: WorkbookService;

  beforeEach(() => {
    vi.clearAllMocks();
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    mockSelect.mockReturnValue({ from });
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    service = new WorkbookService({ select: mockSelect, insert: mockInsert } as any, 'user-1');
  });

  it('inspectWorkbook on on_demand does not enqueue and returns unsupported card', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-on',
      name: 'chat.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      processingPolicy: 'on_demand',
      userId: 'user-1',
    });

    const result = await service.inspectWorkbook('f-on');

    expect(result.parseStatus).toBe('unsupported');
    expect(result.promptCard).toMatch(/on_demand|Resources/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('asyncEnqueueParse no-ops for non-persistent files', async () => {
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

  it('querySheet rejects on_demand without enqueue', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-on',
      name: 'chat.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      processingPolicy: 'on_demand',
      userId: 'user-1',
    });

    await expect(service.querySheet({ fileId: 'f-on', sheet: 'Sheet1' })).rejects.toThrow(
      /persistent|on_demand|Resources/i,
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
