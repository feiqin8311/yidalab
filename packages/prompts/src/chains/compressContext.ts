import type { ChatStreamPayload, CompressionSnapshotV2, UIChatMessage } from '@lobechat/types';

import {
  buildCompressContextSystemPrompt,
  buildCompressContextUserPrompt,
  buildValidatedCompressionResult,
  type ChainCompressContextInput,
  type CompressContextResult,
  type CompressMessageInput,
} from '../prompts/compressContext/snapshot';

export type { ChainCompressContextInput, CompressContextResult, CompressMessageInput };

export interface ChainCompressContextOptions {
  existingSnapshot?: CompressionSnapshotV2 | null;
  legacySummary?: string | null;
  maxSummaryTokens?: number;
}

/**
 * Chain for compressing conversation context into a structured V2 checkpoint.
 *
 * Accepts either a bare messages array (legacy) or a recursive input with
 * existingSnapshot / legacySummary for rolling compression.
 */
export function chainCompressContext(
  messages: UIChatMessage[],
  options?: ChainCompressContextOptions,
): Partial<ChatStreamPayload>;
export function chainCompressContext(input: ChainCompressContextInput): Partial<ChatStreamPayload>;
export function chainCompressContext(
  messagesOrInput: UIChatMessage[] | ChainCompressContextInput,
  options?: ChainCompressContextOptions,
): Partial<ChatStreamPayload> {
  const input: ChainCompressContextInput = Array.isArray(messagesOrInput)
    ? {
        existingSnapshot: options?.existingSnapshot,
        legacySummary: options?.legacySummary,
        maxSummaryTokens: options?.maxSummaryTokens,
        messages: messagesOrInput.map((m) => ({
          content: typeof m.content === 'string' ? m.content : '',
          id: m.id,
          role: m.role,
        })),
      }
    : messagesOrInput;

  return {
    messages: [
      {
        content: buildCompressContextSystemPrompt(input.maxSummaryTokens),
        role: 'system',
      },
      {
        content: buildCompressContextUserPrompt(input),
        role: 'user',
      },
    ],
  };
}

/**
 * Parse + validate model compression output into snapshot + markdown.
 * Shared by client and server paths.
 */
export const finalizeCompressionOutput = (params: {
  raw: string;
  previousSnapshot?: CompressionSnapshotV2 | null;
  messageIds?: string[];
  currentUserMessageIds?: string[];
  userMessages?: Array<{ content: string; id: string }>;
  sourceGroupIds?: string[];
  maxSummaryTokens?: number;
}): CompressContextResult => buildValidatedCompressionResult(params);

/** 8% of window, clamped to [1024, 8192]. */
export const resolveMaxSummaryTokens = (maxWindowToken?: number): number => {
  if (!maxWindowToken || maxWindowToken <= 0) return 2048;
  return Math.min(8192, Math.max(1024, Math.floor(maxWindowToken * 0.08)));
};
