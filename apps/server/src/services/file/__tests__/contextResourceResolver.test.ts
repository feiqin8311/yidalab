import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextResourceResolver } from '../contextResourceResolver';

const mockFindById = vi.fn();
const mockDownloadFileToLocal = vi.fn();
const mockLoadFile = vi.fn();
const mockInspectWorkbook = vi.fn();
const mockParseFile = vi.fn();
const mockDocumentFindByFileId = vi.fn();
const mockIsSpreadsheetFile = vi.fn();
const mockShouldInlineParsedText = vi.fn();

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    findById: mockFindById,
  })),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({
    findByFileId: mockDocumentFindByFileId,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({
    downloadFileToLocal: mockDownloadFileToLocal,
  })),
}));

vi.mock('@/server/services/workbook', () => ({
  WorkbookService: vi.fn(() => ({
    inspectWorkbook: mockInspectWorkbook,
  })),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(() => ({
    parseFile: mockParseFile,
  })),
}));

vi.mock('@lobechat/file-loaders', () => ({
  ALL_FILE_CARDS_MAX_CHARS: 48_000,
  isSpreadsheetFile: (...args: unknown[]) => mockIsSpreadsheetFile(...args),
  loadFile: (...args: unknown[]) => mockLoadFile(...args),
  shouldInlineParsedText: (...args: unknown[]) => mockShouldInlineParsedText(...args),
  UnsupportedFileTypeError: class UnsupportedFileTypeError extends Error {
    fileType: string;
    constructor(fileType: string, filename: string) {
      super(`Unsupported file type '${fileType}' for file '${filename}'.`);
      this.name = 'UnsupportedFileTypeError';
      this.fileType = fileType;
    }
  },
}));

describe('ContextResourceResolver', () => {
  const cleanup = vi.fn();
  let resolver: ContextResourceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new ContextResourceResolver({} as any, 'user-1');
    mockIsSpreadsheetFile.mockReturnValue(false);
    // Default: allow inline. Large-sheet regression forces false so size-block would fire if reintroduced.
    mockShouldInlineParsedText.mockReturnValue(true);
  });

  it('on_demand non-spreadsheet loads content without DocumentService', async () => {
    mockFindById.mockResolvedValue({
      id: 'f1',
      name: 'a.md',
      fileType: 'text/markdown',
      size: 10,
      processingPolicy: 'on_demand',
      url: 's3://x',
    });
    mockDownloadFileToLocal.mockResolvedValue({
      cleanup,
      filePath: '/tmp/a.md',
      file: { name: 'a.md' },
    });
    mockLoadFile.mockResolvedValue({
      content: 'hello world',
      metadata: {},
    });

    const result = await resolver.resolveForPrompt('f1');

    expect(result.status).toBe('ready');
    expect(result.content).toBe('hello world');
    expect(mockParseFile).not.toHaveBeenCalled();
    expect(mockInspectWorkbook).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
  });

  it('on_demand spreadsheet loads in-memory preview without workbook enqueue', async () => {
    mockIsSpreadsheetFile.mockReturnValue(true);
    mockFindById.mockResolvedValue({
      id: 'f2',
      name: 'sheet.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 1000,
      processingPolicy: 'on_demand',
      url: 's3://x',
    });
    mockDownloadFileToLocal.mockResolvedValue({
      cleanup,
      filePath: '/tmp/sheet.xlsx',
      file: { name: 'sheet.xlsx' },
    });
    mockLoadFile.mockResolvedValue({
      content: '| A | B |\n| 1 | 2 |',
      metadata: {},
    });

    const result = await resolver.resolveForPrompt('f2');

    expect(result.status).toBe('partial');
    expect(result.content).toContain('on-demand preview');
    expect(result.content).toContain('| A | B |');
    expect(mockInspectWorkbook).not.toHaveBeenCalled();
    expect(mockParseFile).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
  });

  it('on_demand large spreadsheet still returns capped preview (not size-block)', async () => {
    mockIsSpreadsheetFile.mockReturnValue(true);
    // If sheet path wrongly re-applies shouldInlineParsedText, this forces the size-block message.
    mockShouldInlineParsedText.mockReturnValue(false);
    mockFindById.mockResolvedValue({
      id: 'f2-large',
      name: 'big.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 500_000,
      processingPolicy: 'on_demand',
      url: 's3://x',
    });
    mockDownloadFileToLocal.mockResolvedValue({
      cleanup,
      filePath: '/tmp/big.xlsx',
      file: { name: 'big.xlsx' },
    });
    mockLoadFile.mockResolvedValue({
      content: 'row data '.repeat(2000),
      metadata: {},
    });

    const result = await resolver.resolveForPrompt('f2-large');

    expect(result.status).toBe('partial');
    expect(result.content).toContain('on-demand preview');
    expect(result.content).toContain('row data');
    expect(result.content).not.toContain('too large to inline');
    expect(mockShouldInlineParsedText).not.toHaveBeenCalled();
    expect(mockParseFile).not.toHaveBeenCalled();
  });

  it('unsupported type returns unsupported status', async () => {
    const { UnsupportedFileTypeError } = await import('@lobechat/file-loaders');
    mockFindById.mockResolvedValue({
      id: 'f3',
      name: 'a.bin',
      fileType: 'application/octet-stream',
      size: 1,
      processingPolicy: 'on_demand',
      url: 's3://x',
    });
    mockDownloadFileToLocal.mockResolvedValue({
      cleanup,
      filePath: '/tmp/a.bin',
      file: { name: 'a.bin' },
    });
    mockLoadFile.mockRejectedValue(new UnsupportedFileTypeError('bin', 'a.bin'));

    const result = await resolver.resolveForPrompt('f3');

    expect(result.status).toBe('unsupported');
    expect(mockParseFile).not.toHaveBeenCalled();
  });

  it('persistent spreadsheet uses WorkbookService.inspectWorkbook', async () => {
    mockIsSpreadsheetFile.mockReturnValue(true);
    mockFindById.mockResolvedValue({
      id: 'f4',
      name: 'sheet.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 1000,
      processingPolicy: 'persistent',
      url: 's3://x',
    });
    mockInspectWorkbook.mockResolvedValue({
      promptCard: 'Workbook card',
      parseStatus: 'ready',
    });

    const result = await resolver.resolveForPrompt('f4');

    expect(result.status).toBe('ready');
    expect(result.content).toBe('Workbook card');
    expect(mockInspectWorkbook).toHaveBeenCalledWith('f4');
  });

  it('writeMode=never reads stored document only and never calls parseFile', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-persist',
      name: 'doc.pdf',
      fileType: 'application/pdf',
      size: 100,
      processingPolicy: 'persistent',
      url: 's3://x',
    });
    mockDocumentFindByFileId.mockResolvedValue({
      content: 'already indexed body',
      id: 'docs_1',
    });

    const result = await resolver.resolveForPrompt('f-persist', {}, { writeMode: 'never' });

    expect(result.status).toBe('ready');
    expect(result.content).toBe('already indexed body');
    expect(mockParseFile).not.toHaveBeenCalled();
    expect(mockInspectWorkbook).not.toHaveBeenCalled();
    expect(mockDownloadFileToLocal).not.toHaveBeenCalled();
  });

  it('writeMode=never fails closed when persistent document row is missing', async () => {
    mockFindById.mockResolvedValue({
      id: 'f-missing-doc',
      name: 'doc.pdf',
      fileType: 'application/pdf',
      size: 100,
      processingPolicy: 'persistent',
      url: 's3://x',
    });
    mockDocumentFindByFileId.mockResolvedValue(null);

    const result = await resolver.resolveForPrompt('f-missing-doc', {}, { writeMode: 'never' });

    expect(result.status).toBe('failed');
    expect(result.warnings.join(' ')).toContain('no stored document body');
    expect(mockParseFile).not.toHaveBeenCalled();
  });

  it('uses options.file and skips FileModel.findById; passes record to download', async () => {
    mockDownloadFileToLocal.mockResolvedValue({
      cleanup,
      filePath: '/tmp/a.md',
      file: { name: 'a.md' },
    });
    mockLoadFile.mockResolvedValue({ content: 'from preloaded row', metadata: {} });

    const preloaded = {
      id: 'f-pre',
      name: 'a.md',
      fileType: 'text/markdown',
      size: 10,
      processingPolicy: 'on_demand' as const,
      url: 's3://x',
    };
    const result = await resolver.resolveForPrompt('f-pre', {}, { file: preloaded });

    expect(result.content).toBe('from preloaded row');
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockDownloadFileToLocal).toHaveBeenCalledWith('f-pre', {
      id: 'f-pre',
      name: 'a.md',
      url: 's3://x',
    });
  });
});
