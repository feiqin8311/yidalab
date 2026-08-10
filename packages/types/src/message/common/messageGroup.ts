/**
 * Message group type
 * - parallel: multi-model parallel conversations
 * - compression: compressed message group
 */
import type {
  CompressionDegradedReason,
  CompressionScope,
  CompressionSnapshotV2,
} from './compressionSnapshot';

export const MessageGroupType = {
  Parallel: 'parallel',
  Compression: 'compression',
} as const;

export type IMessageGroupType = (typeof MessageGroupType)[keyof typeof MessageGroupType];

/**
 * Metadata for compression type message groups
 */
export interface CompressionGroupMetadata {
  /** Active hard-constraint count after inheritance repair. */
  activeHardConstraintCount?: number;
  compressedAt?: string;
  compressedTokenCount?: number;

  // Compression info
  compressionStrategy?: 'summarize';
  /** Degradation / repair flags for observability. */
  degraded?: CompressionDegradedReason[];
  endMessageId?: string;

  // UI state
  expanded?: boolean;
  /** Group ids merged into this rolling checkpoint. */
  mergedGroupIds?: string[];

  /** Newly added constraints in this pass. */
  newConstraintCount?: number;

  originalMessageCount?: number;
  // Statistics
  originalTokenCount?: number;
  /** Number of parse retries performed before success (0–1). */
  parseRetries?: number;
  pinnedMessageIds?: string[];
  /** Topic/thread/group scope for this checkpoint. */
  scope?: CompressionScope;
  /** Structured checkpoint (V2). Prefer this over parsing content. */
  snapshot?: CompressionSnapshotV2;
  /** Snapshot schema version present on this group (2 when snapshot is set). */
  snapshotVersion?: number;
  // Compression range
  startMessageId?: string;
  /** Constraints marked superseded in this pass. */
  supersededConstraintCount?: number;
  /** Token count of the rendered summary after compression. */
  tokensAfter?: number;
  /** Token count before this compression pass. */
  tokensBefore?: number;
}

/**
 * Message group item
 */
export interface MessageGroupItem {
  clientId?: string | null;
  content?: string | null;
  createdAt: Date;
  description?: string | null;
  editorData?: any | null;

  id: string;
  parentGroupId?: string | null;

  parentMessageId?: string | null;
  // Metadata
  title?: string | null;
  topicId?: string | null;

  // Compression fields
  type?: IMessageGroupType | null;
  updatedAt: Date;
  userId: string;
}
