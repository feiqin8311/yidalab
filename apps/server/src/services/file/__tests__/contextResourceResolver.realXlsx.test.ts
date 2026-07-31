/**
 * Real-file smoke: 控笔套装 2.0 词库.xlsx (~5MB).
 * Verifies on_demand spreadsheet path does not size-block and returns preview.
 */
import { existsSync, statSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextResourceResolver } from '../contextResourceResolver';

const XLSX_PATH = '/Users/kerden/Desktop/326209 控笔套装2.0 词库.xlsx';
const XLSX_NAME = '326209 控笔套装2.0 词库.xlsx';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const mockFindById = vi.fn();
const mockDownloadFileToLocal = vi.fn();
const mockParseFile = vi.fn();
const mockInspectWorkbook = vi.fn();
const mockShouldInlineParsedText = vi.fn();

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    findById: mockFindById,
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

// Real loadFile / isSpreadsheetFile; only stub shouldInline so size-block would fire if reintroduced.
vi.mock('@lobechat/file-loaders', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    shouldInlineParsedText: (...args: unknown[]) => mockShouldInlineParsedText(...args),
  };
});

describe.skipIf(!existsSync(XLSX_PATH))('ContextResourceResolver real xlsx', () => {
  const size = existsSync(XLSX_PATH) ? statSync(XLSX_PATH).size : 0;
  let resolver: ContextResourceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new ContextResourceResolver({} as any, 'user-1');
    // Force false: if sheet path wrongly calls shouldInline, content becomes "too large to inline".
    mockShouldInlineParsedText.mockReturnValue(false);
    mockFindById.mockResolvedValue({
      id: 'real-xlsx-1',
      name: XLSX_NAME,
      fileType: XLSX_TYPE,
      size,
      processingPolicy: 'on_demand',
      url: 's3://test/xlsx',
    });
    mockDownloadFileToLocal.mockResolvedValue({
      cleanup: vi.fn(),
      filePath: XLSX_PATH,
      file: { name: XLSX_NAME },
    });
  });

  it('on_demand ~5MB xlsx returns capped preview (not size-block, no DocumentService)', async () => {
    expect(size).toBeGreaterThan(200_000);

    const result = await resolver.resolveForPrompt('real-xlsx-1');

    expect(result.status).toBe('partial');
    expect(result.content).toBeTruthy();
    expect(result.content).toMatch(/on-demand preview|Spreadsheet fileId=/i);
    expect(result.content).not.toContain('too large to inline');
    // Sheet data should surface (Chinese header from 词库)
    expect(result.content).toMatch(/关键词|magic grooved|控笔|sheet/i);
    expect(mockParseFile).not.toHaveBeenCalled();
    expect(mockInspectWorkbook).not.toHaveBeenCalled();
    expect(mockShouldInlineParsedText).not.toHaveBeenCalled();
  }, 30_000);
});
