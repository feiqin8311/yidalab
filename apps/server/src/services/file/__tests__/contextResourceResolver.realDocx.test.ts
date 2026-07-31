/**
 * Real-file smoke: 326209 listing docx pair (Amazon listing drafts).
 * Verifies on_demand path extracts full text from both files for compare prompts.
 */
import { existsSync, statSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextResourceResolver } from '../contextResourceResolver';

const DOCX_A = '/Users/kerden/Desktop/326209 控笔套装2 listing(2).docx';
const DOCX_B = '/Users/kerden/Desktop/326209 控笔套装2 listing.docx';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const mockFindById = vi.fn();
const mockDownloadFileToLocal = vi.fn();
const mockParseFile = vi.fn();
const mockInspectWorkbook = vi.fn();

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

const bothExist = existsSync(DOCX_A) && existsSync(DOCX_B);

describe.skipIf(!bothExist)('ContextResourceResolver real listing docx', () => {
  let resolver: ContextResourceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new ContextResourceResolver({} as any, 'user-1');
  });

  const stubFile = (id: string, path: string, name: string) => {
    const size = statSync(path).size;
    mockFindById.mockResolvedValue({
      id,
      name,
      fileType: DOCX_TYPE,
      size,
      processingPolicy: 'on_demand',
      url: `s3://test/${id}`,
    });
    mockDownloadFileToLocal.mockResolvedValue({
      cleanup: vi.fn(),
      filePath: path,
      file: { name },
    });
  };

  it('on_demand listing(2).docx extracts title + bullets + ST (no DocumentService)', async () => {
    stubFile('docx-a', DOCX_A, '326209 控笔套装2 listing(2).docx');

    const result = await resolver.resolveForPrompt('docx-a');

    expect(result.status).toBe('ready');
    expect(result.content).toMatch(/YPLUS Magic Grooved Writing Practice/i);
    expect(result.content).toMatch(/Bullet point/i);
    expect(result.content).toMatch(/magic grooved writing practice/i);
    expect(result.content).not.toContain('too large to inline');
    expect(result.content).not.toMatch(/lobe-cloud-sandbox|use sandbox tools/i);
    expect(mockParseFile).not.toHaveBeenCalled();
    expect(mockInspectWorkbook).not.toHaveBeenCalled();
  }, 30_000);

  it('on_demand listing.docx (Sunday optimized) extracts Why Parents + gift Q', async () => {
    stubFile('docx-b', DOCX_B, '326209 控笔套装2 listing.docx');

    const result = await resolver.resolveForPrompt('docx-b');

    expect(result.status).toBe('ready');
    expect(result.content).toMatch(/Why Parents and Teachers Choose YPLUS/i);
    expect(result.content).toMatch(/Would this make a good gift/i);
    expect(result.content).toMatch(/Handwriting Without Tears/i);
    expect(result.content!.length).toBeGreaterThan(5000);
    expect(mockParseFile).not.toHaveBeenCalled();
  }, 30_000);

  it('both files yield distinct content for compare prompts', async () => {
    stubFile('docx-a', DOCX_A, '326209 控笔套装2 listing(2).docx');
    const a = await resolver.resolveForPrompt('docx-a');

    stubFile('docx-b', DOCX_B, '326209 控笔套装2 listing.docx');
    const b = await resolver.resolveForPrompt('docx-b');

    expect(a.content).toBeTruthy();
    expect(b.content).toBeTruthy();
    expect(a.content).not.toEqual(b.content);
    // B is the longer optimized draft
    expect(b.content?.length ?? 0).toBeGreaterThan(a.content?.length ?? 0);
    // Shared product identity
    expect(a.content).toMatch(/Ages 3-8/i);
    expect(b.content).toMatch(/Ages 3-8/i);
    // B-only sections
    expect(b.content).toMatch(/Why Parents and Teachers/i);
    expect(a.content).not.toMatch(/Why Parents and Teachers/i);
  }, 30_000);
});
