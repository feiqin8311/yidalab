import type { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectEmptyAttachmentFileIds,
  hydrateMessageAttachmentsForPrompt,
  MAX_PROMPT_RESOLVE_FILE_IDS,
  mergeAttachmentContentsIntoMessages,
  RESOLVE_ATTACHMENTS_BATCH_SIZE,
  resolveAndMergeAttachmentContents,
} from './hydrateMessageAttachments';

const resolveAttachmentsForPrompt = vi.fn();

vi.mock('@/services/file', () => ({
  fileService: {
    resolveAttachmentsForPrompt: (...args: unknown[]) => resolveAttachmentsForPrompt(...args),
  },
}));

const msg = (partial: Partial<UIChatMessage> & { id: string }): UIChatMessage =>
  ({
    content: '',
    role: 'user',
    ...partial,
  }) as UIChatMessage;

const emptyDoc = (id: string) => ({
  id,
  name: `${id}.docx`,
  fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 10,
  url: `https://x/${id}`,
});

describe('hydrateMessageAttachments', () => {
  beforeEach(() => {
    resolveAttachmentsForPrompt.mockReset();
  });

  describe('collectEmptyAttachmentFileIds', () => {
    it('collects non-media file ids with empty content, newest first', () => {
      const messages = [
        msg({
          id: 'u0',
          fileList: [emptyDoc('file_old')],
        }),
        msg({
          id: 'u1',
          fileList: [
            emptyDoc('file_a'),
            {
              id: 'file_img',
              name: 'x.png',
              fileType: 'image/png',
              size: 1,
              url: 'https://x/i',
            },
            {
              id: 'file_b',
              name: 'b.txt',
              fileType: 'text/plain',
              size: 2,
              url: 'https://x/b',
              content: 'already',
            },
          ],
        }),
      ];

      expect(collectEmptyAttachmentFileIds(messages)).toEqual(['file_a', 'file_old']);
    });

    it('caps at MAX_PROMPT_RESOLVE_FILE_IDS preferring newest', () => {
      const files = Array.from({ length: MAX_PROMPT_RESOLVE_FILE_IDS + 5 }, (_, i) =>
        emptyDoc(`file_${i}`),
      );
      const messages = [
        msg({ id: 'old', fileList: files.slice(0, 5) }),
        msg({ id: 'new', fileList: files.slice(5) }),
      ];
      const ids = collectEmptyAttachmentFileIds(messages);
      expect(ids).toHaveLength(MAX_PROMPT_RESOLVE_FILE_IDS);
      expect(ids[0]).toBe(`file_${MAX_PROMPT_RESOLVE_FILE_IDS + 4}`);
      expect(ids).not.toContain('file_0');
    });
  });

  describe('mergeAttachmentContentsIntoMessages', () => {
    it('merges content in memory without mutating input', () => {
      const originalFile = emptyDoc('file_a');
      const messages = [msg({ id: 'u1', fileList: [originalFile] })];
      const next = mergeAttachmentContentsIntoMessages(messages, [
        { ...originalFile, content: 'Listing body' },
      ]);

      expect(next[0].fileList?.[0].content).toBe('Listing body');
      expect(originalFile).not.toHaveProperty('content');
      expect(messages[0].fileList?.[0]).toBe(originalFile);
    });
  });

  describe('hydrateMessageAttachmentsForPrompt', () => {
    it('skips network when nothing needs text', async () => {
      const messages = [msg({ id: 'u1', content: 'hi' })];
      const result = await hydrateMessageAttachmentsForPrompt(messages);
      expect(result).toBe(messages);
      expect(resolveAttachmentsForPrompt).not.toHaveBeenCalled();
    });

    it('resolves empty docx bodies for client prompt', async () => {
      const file = emptyDoc('file_docx');
      const messages = [msg({ id: 'u1', fileList: [file] })];
      resolveAttachmentsForPrompt.mockResolvedValue({
        audioList: [],
        diagnostics: [],
        fileList: [{ ...file, content: 'SKU-1\nSKU-2' }],
        imageList: [],
        orderedFileIds: ['file_docx'],
        videoList: [],
        warnings: [],
      });

      const result = await hydrateMessageAttachmentsForPrompt(messages);

      expect(resolveAttachmentsForPrompt).toHaveBeenCalledWith(['file_docx']);
      expect(result[0].fileList?.[0].content).toBe('SKU-1\nSKU-2');
    });

    it('batches file ids over the TRPC max and keeps partial successes', async () => {
      const ids = Array.from({ length: RESOLVE_ATTACHMENTS_BATCH_SIZE + 3 }, (_, i) => `file_${i}`);
      // Newest-first: reverse order in one message so batch0 is highest indices first
      const messages = [msg({ id: 'u1', fileList: ids.map((id) => emptyDoc(id)) })];

      resolveAttachmentsForPrompt.mockImplementation(async (batch: string[]) => {
        if (batch.includes('file_0')) {
          throw new Error('batch with file_0 failed');
        }
        return {
          audioList: [],
          diagnostics: [],
          fileList: batch.map((id) => ({ ...emptyDoc(id), content: `body-${id}` })),
          imageList: [],
          orderedFileIds: batch,
          videoList: [],
          warnings: [],
        };
      });

      const result = await hydrateMessageAttachmentsForPrompt(messages);

      expect(resolveAttachmentsForPrompt).toHaveBeenCalledTimes(2);
      // Newest-first collection: file_{n-1} first ... file_0 last, so last batch has file_0 and fails
      const lastId = `file_${ids.length - 1}`;
      expect(result[0].fileList?.find((f) => f.id === lastId)?.content).toBe(`body-${lastId}`);
    });

    it('fails open when resolve errors', async () => {
      const file = emptyDoc('file_docx');
      const messages = [msg({ id: 'u1', fileList: [file] })];
      resolveAttachmentsForPrompt.mockRejectedValue(new Error('network'));

      const result = await hydrateMessageAttachmentsForPrompt(messages);
      expect(result).toEqual(messages);
    });
  });

  describe('resolveAndMergeAttachmentContents', () => {
    it('resolves once across multiple message lists', async () => {
      const file = emptyDoc('shared');
      const listA = [msg({ id: 'a', fileList: [file] })];
      const listB = [msg({ id: 'b', fileList: [file] })];
      resolveAttachmentsForPrompt.mockResolvedValue({
        audioList: [],
        diagnostics: [],
        fileList: [{ ...file, content: 'once' }],
        imageList: [],
        orderedFileIds: ['shared'],
        videoList: [],
        warnings: [],
      });

      const [a, b] = await resolveAndMergeAttachmentContents([listA, listB]);

      expect(resolveAttachmentsForPrompt).toHaveBeenCalledTimes(1);
      expect(a?.[0].fileList?.[0].content).toBe('once');
      expect(b?.[0].fileList?.[0].content).toBe('once');
    });
  });
});
