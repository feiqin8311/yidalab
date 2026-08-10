/**
 * Conversation Context Compression Prompt
 *
 * Structured V2 checkpoint compression. Prefer chainCompressContext +
 * snapshot helpers for runtime use.
 */

import { buildCompressContextSystemPrompt } from './snapshot';

export {
  buildCompressContextSystemPrompt,
  buildCompressContextUserPrompt,
  buildValidatedCompressionResult,
  type ChainCompressContextInput,
  type CompressContextResult,
  type CompressMessageInput,
  estimateSummaryTokens,
  extractJsonObject,
  inheritConstraints,
  parseCompressionSnapshot,
  readSnapshotFromMetadata,
  renderCompressionMarkdown,
  trimSnapshotToBudget,
} from './snapshot';

/** Default system prompt (2048 token budget guidance). */
export const compressContextSystemPrompt = buildCompressContextSystemPrompt();

/** Default user footer when not using buildCompressContextUserPrompt. */
export const compressContextUserPrompt = `Merge existing_snapshot/legacy_summary with messages_to_merge into one CompressionSnapshotV2 JSON object. Output ONLY the JSON object.`;
