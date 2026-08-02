import { describe, expect, it, vi } from 'vitest';

import { FilesExecutionRuntime } from './index';

describe('FilesExecutionRuntime', () => {
  const file = {
    fileType: 'text/plain',
    id: 'file-1',
    name: 'notes.txt',
    parseStatus: 'uploaded',
    processingPolicy: 'on_demand',
    size: 100,
  };

  it('inspectAttachment returns unparsed metadata only (no extract)', async () => {
    const extractFull = vi.fn();
    const runtime = new FilesExecutionRuntime({
      extractFull,
      getReadableFile: vi.fn().mockResolvedValue(file),
    });

    const result = await runtime.inspectAttachment({ fileId: 'file-1' });
    expect(result.success).toBe(true);
    expect(extractFull).not.toHaveBeenCalled();
    const payload = JSON.parse(result.content);
    expect(payload).toMatchObject({
      extractable: 'likely',
      fileId: 'file-1',
      name: 'notes.txt',
      status: 'unparsed',
    });
  });

  it('inspectAttachment marks zip as unlikely', async () => {
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn(),
      getReadableFile: vi.fn().mockResolvedValue({
        ...file,
        fileType: 'application/zip',
        name: 'a.zip',
      }),
    });
    const result = await runtime.inspectAttachment({ fileId: 'file-1' });
    const payload = JSON.parse(result.content);
    expect(payload.extractable).toBe('unlikely');
    expect(payload.status).toBe('unparsed');
  });

  it('readAttachment pages with nextOffset over full extract', async () => {
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn().mockResolvedValue({
        content: 'abcdefghij',
        status: 'ready',
        totalLength: 10,
        warnings: [],
      }),
      getReadableFile: vi.fn().mockResolvedValue(file),
    });

    const first = await runtime.readAttachment({ fileId: 'file-1', limit: 4, offset: 0 });
    expect(first.success).toBe(true);
    const p1 = JSON.parse(first.content);
    expect(p1.content).toBe('abcd');
    expect(p1.nextOffset).toBe(4);
    expect(p1.truncated).toBe(true);

    const second = await runtime.readAttachment({ fileId: 'file-1', limit: 10, offset: 4 });
    const p2 = JSON.parse(second.content);
    expect(p2.content).toBe('efghij');
    expect(p2.nextOffset).toBeNull();
    expect(p2.truncated).toBe(false);
  });

  it('readAttachment filters structured pages by pageNumber', async () => {
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn().mockResolvedValue({
        content: 'full joined',
        pages: [
          { content: 'page one body', pageNumber: 1 },
          { content: 'page two body', pageNumber: 2 },
        ],
        status: 'ready',
        warnings: [],
      }),
      getReadableFile: vi.fn().mockResolvedValue(file),
    });

    const result = await runtime.readAttachment({ fileId: 'file-1', pages: [2] });
    const payload = JSON.parse(result.content);
    expect(payload.content).toBe('page two body');
  });

  it('readAttachment fails PAGE_NOT_FOUND for missing page instead of full body', async () => {
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn().mockResolvedValue({
        content: 'full joined',
        pages: [
          { content: 'page one body', pageNumber: 1 },
          { content: 'page two body', pageNumber: 2 },
        ],
        status: 'ready',
        warnings: [],
      }),
      getReadableFile: vi.fn().mockResolvedValue(file),
    });

    const result = await runtime.readAttachment({ fileId: 'file-1', pages: [999] });
    expect(result.success).toBe(false);
    expect(result.content).toContain('No pages matched');
  });

  it('successJson always returns parseable JSON even with quote-heavy content', async () => {
    // 12k quotes serialize to ~24k JSON; must shrink content field, not slice mid-string.
    const heavy = '"'.repeat(12_000);
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn().mockResolvedValue({
        content: heavy,
        status: 'ready',
        warnings: [],
      }),
      getReadableFile: vi.fn().mockResolvedValue(file),
    });

    const result = await runtime.readAttachment({ fileId: 'file-1', limit: 12_000, offset: 0 });
    expect(result.success).toBe(true);
    expect(() => JSON.parse(result.content)).not.toThrow();
    const payload = JSON.parse(result.content);
    expect(payload.fileId).toBe('file-1');
    expect(typeof payload.content).toBe('string');
  });

  it('paged reads reassemble full quote-heavy body without silent drops', async () => {
    // 20k quotes: each page must advance nextOffset by emitted length after MODEL_MAX shrink.
    const original = '"'.repeat(20_000);
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn().mockResolvedValue({
        content: original,
        status: 'ready',
        totalLength: original.length,
        warnings: [],
      }),
      getReadableFile: vi.fn().mockResolvedValue(file),
    });

    let offset = 0;
    let assembled = '';
    let pages = 0;
    while (pages < 50) {
      pages += 1;
      const result = await runtime.readAttachment({
        fileId: 'file-1',
        limit: 12_000,
        offset,
      });
      expect(result.success).toBe(true);
      const payload = JSON.parse(result.content) as {
        content: string;
        nextOffset: number | null;
      };
      assembled += payload.content;
      if (payload.nextOffset === null || payload.nextOffset === undefined) break;
      expect(payload.nextOffset).toBe(offset + payload.content.length);
      offset = payload.nextOffset;
    }

    expect(assembled).toBe(original);
    expect(assembled.length).toBe(20_000);
  });

  it('searchAttachment returns snippets from full extract (beyond 80k)', async () => {
    const longPrefix = 'x'.repeat(90_000);
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn().mockResolvedValue({
        content: `${longPrefix}needle-here`,
        status: 'ready',
        totalLength: 90_000 + 11,
        warnings: [],
      }),
      getReadableFile: vi.fn().mockResolvedValue(file),
    });

    const result = await runtime.searchAttachment({ fileId: 'file-1', query: 'needle' });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.content);
    expect(payload.matches).toHaveLength(1);
    expect(payload.matches[0].offset).toBe(90_000);
  });

  it('fails closed when file is not readable', async () => {
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn(),
      getReadableFile: vi.fn().mockResolvedValue(null),
    });

    const result = await runtime.inspectAttachment({ fileId: 'missing' });
    expect(result.success).toBe(false);
    expect(result.content).toContain('not found');
  });

  it('fails with NO_CONTENT when extract is empty', async () => {
    const runtime = new FilesExecutionRuntime({
      extractFull: vi.fn().mockResolvedValue({
        status: 'unsupported',
        warnings: ['binary'],
      }),
      getReadableFile: vi.fn().mockResolvedValue(file),
    });

    const result = await runtime.readAttachment({ fileId: 'file-1' });
    expect(result.success).toBe(false);
    expect(result.content).toContain('no extractable text');
  });
});
