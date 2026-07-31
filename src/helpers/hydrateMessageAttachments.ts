import type { ChatFileItem, UIChatMessage } from '@lobechat/types';
import debug from 'debug';

import { fileService } from '@/services/file';

const log = debug('lobe-chat:hydrateMessageAttachments');

/** Matches server resolveAttachmentsForPrompt input max. */
export const RESOLVE_ATTACHMENTS_BATCH_SIZE = 20;

/**
 * Run-level cap: prefer newest messages; skip older empty attachments so long
 * threads do not block first-token with unbounded S3/mammoth work.
 * Final prompt still applies filesPrompts card budget independently.
 */
export const MAX_PROMPT_RESOLVE_FILE_IDS = 40;

const isMediaFileType = (fileType?: string) => {
  if (!fileType) return false;
  return (
    fileType.startsWith('image') || fileType.startsWith('video') || fileType.startsWith('audio')
  );
};

const needsPromptText = (file: ChatFileItem) =>
  !isMediaFileType(file.fileType) && !file.content?.trim();

/**
 * Newest-first empty non-media attachment ids, capped for prompt-time resolve.
 */
export const collectEmptyAttachmentFileIds = (
  messages: UIChatMessage[],
  maxIds: number = MAX_PROMPT_RESOLVE_FILE_IDS,
): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  // Walk from the end so the current user turn wins over deep history.
  // Within a turn, later fileList entries (usually last uploaded) win the cap.
  for (let i = messages.length - 1; i >= 0; i--) {
    const fileList = messages[i]?.fileList ?? [];
    for (let j = fileList.length - 1; j >= 0; j--) {
      const file = fileList[j];
      if (!file?.id || !needsPromptText(file) || seen.has(file.id)) continue;
      seen.add(file.id);
      ids.push(file.id);
      if (ids.length >= maxIds) return ids;
    }
  }
  return ids;
};

/**
 * Merge resolved prompt bodies onto message.fileList in memory only.
 * Does not mutate the input arrays/objects; does not touch DB / agents_files.
 */
export const mergeAttachmentContentsIntoMessages = (
  messages: UIChatMessage[],
  resolvedFiles: ChatFileItem[],
): UIChatMessage[] => {
  if (resolvedFiles.length === 0) return messages;
  const byId = new Map(resolvedFiles.map((file) => [file.id, file]));

  return messages.map((message) => {
    if (!message.fileList?.length) return message;
    let changed = false;
    const fileList = message.fileList.map((file) => {
      const resolved = byId.get(file.id);
      if (!resolved?.content?.trim() || file.content?.trim()) return file;
      changed = true;
      return {
        ...file,
        content: resolved.content,
        parseStatus: resolved.parseStatus ?? file.parseStatus,
      };
    });
    return changed ? { ...message, fileList } : message;
  });
};

const chunkIds = (ids: string[], size: number): string[][] => {
  if (ids.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    batches.push(ids.slice(i, i + size));
  }
  return batches;
};

/**
 * Resolve empty attachment bodies once, then merge into each message list.
 * Newest-first + run cap; batches under TRPC max; partial batch failure keeps others.
 */
export const resolveAndMergeAttachmentContents = async (
  messageLists: UIChatMessage[][],
): Promise<UIChatMessage[][]> => {
  const fileIds = collectEmptyAttachmentFileIds(messageLists.flat());
  if (fileIds.length === 0) return messageLists;

  const resolvedFiles: ChatFileItem[] = [];
  for (const batch of chunkIds(fileIds, RESOLVE_ATTACHMENTS_BATCH_SIZE)) {
    try {
      const resolved = await fileService.resolveAttachmentsForPrompt(batch);
      if (resolved.fileList.length) resolvedFiles.push(...resolved.fileList);
    } catch (error) {
      // Keep other batches; empty-body cards remain for failed ids.
      log('hydrate batch failed (%d ids): %O', batch.length, error);
    }
  }

  if (resolvedFiles.length === 0) return messageLists;
  log(
    'hydrated %d attachment(s) for client prompt (cap=%d)',
    resolvedFiles.length,
    MAX_PROMPT_RESOLVE_FILE_IDS,
  );
  return messageLists.map((messages) =>
    mergeAttachmentContentsIntoMessages(messages, resolvedFiles),
  );
};

/**
 * Client-runtime prompt-time hydration for on_demand chat attachments.
 * Mirrors gateway resolveRunAttachments: extract once before LLM, in-memory only.
 */
export const hydrateMessageAttachmentsForPrompt = async (
  messages: UIChatMessage[],
): Promise<UIChatMessage[]> => {
  const [next] = await resolveAndMergeAttachmentContents([messages]);
  return next ?? messages;
};
