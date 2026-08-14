import { afterEach, describe, expect, it, vi } from 'vitest';

import { ingestAttachment, MAX_ATTACHMENT_BYTES } from '../ingestAttachment';

const { mockSsrfSafeFetch } = vi.hoisted(() => ({
  mockSsrfSafeFetch: vi.fn(),
}));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: mockSsrfSafeFetch,
}));

vi.mock('sharp', () => ({
  default: vi.fn(),
}));

vi.mock('@lobechat/utils', () => ({
  nanoid: () => 'nano',
}));

describe('ingestAttachment size caps', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const fileService = {
    getFileAccessUrl: vi.fn().mockResolvedValue('https://s3/x'),
    uploadFromBuffer: vi.fn().mockResolvedValue({ fileId: 'f1', key: 'k1' }),
  } as any;

  it('rejects oversized buffers', async () => {
    const buffer = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1);
    await expect(
      ingestAttachment({ buffer, mimeType: 'text/plain', name: 'big.txt' }, fileService, 'u1'),
    ).rejects.toThrow(/too large/);
    expect(fileService.uploadFromBuffer).not.toHaveBeenCalled();
  });

  it('rejects declared size over cap before download', async () => {
    await expect(
      ingestAttachment(
        {
          mimeType: 'text/plain',
          name: 'big.txt',
          size: MAX_ATTACHMENT_BYTES + 10,
          url: 'https://x',
        },
        fileService,
        'u1',
      ),
    ).rejects.toThrow(/too large/);
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it('rejects soft-capped URL downloads at MAX+1', async () => {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 2), {
        headers: { 'content-type': 'text/plain' },
        status: 200,
      }),
    );

    await expect(
      ingestAttachment(
        { mimeType: 'text/plain', name: 'big.txt', url: 'https://cdn.example/big.txt' },
        fileService,
        'u1',
      ),
    ).rejects.toThrow(/size cap|too large/i);
    expect(fileService.uploadFromBuffer).not.toHaveBeenCalled();
  });

  it('accepts buffers at the cap', async () => {
    const buffer = Buffer.alloc(1024, 3);
    const result = await ingestAttachment(
      { buffer, mimeType: 'text/plain', name: 'ok.txt' },
      fileService,
      'u1',
    );
    expect(result.fileId).toBe('f1');
    expect(fileService.uploadFromBuffer).toHaveBeenCalledWith(
      buffer,
      'text/plain',
      expect.stringContaining('ok.txt'),
      { processingPolicy: 'on_demand' },
    );
  });

  it('persists resource-library attachments privately', async () => {
    const buffer = Buffer.from('dingtalk attachment');

    await ingestAttachment(
      {
        buffer,
        mimeType: 'text/plain',
        name: 'report.txt',
        persistToResourceLibrary: true,
      },
      fileService,
      'u1',
    );

    expect(fileService.uploadFromBuffer).toHaveBeenCalledWith(
      buffer,
      'text/plain',
      expect.stringContaining('report.txt'),
      { processingPolicy: 'persistent', visibility: 'private' },
    );
  });
});
