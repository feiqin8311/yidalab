import type {
  CompressionGroupMetadata,
  CompressionSnapshotV2,
  OpenAIChatMessage,
  UIChatMessage,
} from '@lobechat/types';

export interface CompressionGroupCreateInput {
  agentId?: string;
  groupId?: string;
  messageIds: string[];
  threadId?: string;
  topicId: string;
  workspaceId?: string;
}

export interface CompressionGroupCreateResult {
  messageGroupId: string;
  messages?: UIChatMessage[];
  messagesToSummarize: UIChatMessage[];
}

export interface CompressionPromptInput {
  existingSnapshot?: CompressionSnapshotV2 | null;
  /** @deprecated Prefer existingSnapshot; kept for legacy callers. */
  existingSummary?: string;
  legacySummary?: string | null;
  maxSummaryTokens?: number;
  messages: UIChatMessage[];
  /** Prior compression group ids to merge into the rolling checkpoint. */
  sourceGroupIds?: string[];
}

export interface CompressionPromptResult {
  messages: OpenAIChatMessage[];
}

export interface CompressionParseInput {
  /** User-role message ids from this batch only (authorize new/supersede). */
  currentUserMessageIds?: string[];
  existingSnapshot?: CompressionSnapshotV2 | null;
  maxSummaryTokens?: number;
  /** @deprecated Prefer currentUserMessageIds */
  messageIds?: string[];
  raw: string;
  sourceGroupIds?: string[];
  /** Current-batch user message bodies for constraint evidence checks. */
  userMessages?: Array<{ content: string; id: string }>;
}

export interface CompressionParseResult {
  content: string;
  metadata: Partial<CompressionGroupMetadata>;
  snapshot: CompressionSnapshotV2;
}

export interface CompressionGroupFinalizeInput {
  agentId?: string;
  /** Validated markdown content only — never raw unparsed model JSON. */
  content: string;
  groupId?: string;
  /** When set, commit as rolling checkpoint: regroup messages + delete these groups. */
  mergeGroupIds?: string[];
  messageGroupId: string;
  /** Uncompressed message ids folded in this pass (old group children migrated by repo). */
  messageIds?: string[];
  metadata?: Partial<CompressionGroupMetadata>;
  /** Required for V2 path — validated snapshot from parseOutput. */
  snapshot?: CompressionSnapshotV2;
  threadId?: string;
  topicId: string;
  workspaceId?: string;
}

export interface CompressionGroupFinalizeResult {
  messages?: UIChatMessage[];
}

export interface CompressionGroupCancelInput {
  agentId?: string;
  groupId?: string;
  messageGroupId: string;
  threadId?: string;
  topicId: string;
  workspaceId?: string;
}

export interface CompressionGroupCancelResult {
  messages?: UIChatMessage[];
}

/**
 * Persistence + prompt-preparation port for context compression.
 *
 * Compression is not just an LLM call: it creates a visible compressed-message
 * group, summarizes the grouped messages, then finalizes the group content.
 * Keeping those steps behind this transport lets package executors stay free of
 * database services and prompt-package dependencies.
 */
export interface CompressionTransport {
  buildPrompt: (input: CompressionPromptInput) => Promise<CompressionPromptResult>;
  /** Delete a placeholder/failed group and restore message grouping. */
  cancelGroup: (input: CompressionGroupCancelInput) => Promise<CompressionGroupCancelResult>;
  createGroup: (input: CompressionGroupCreateInput) => Promise<CompressionGroupCreateResult>;
  /** Persist already-validated content + snapshot only. */
  finalizeGroup: (input: CompressionGroupFinalizeInput) => Promise<CompressionGroupFinalizeResult>;
  /**
   * Strict V2 parse + constraint inheritance. MUST throw on invalid schema
   * (executor retries once). Transport must not silently accept free-form text.
   */
  parseOutput: (input: CompressionParseInput) => Promise<CompressionParseResult>;
}
