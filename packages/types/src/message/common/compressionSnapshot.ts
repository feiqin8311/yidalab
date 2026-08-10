import { z } from 'zod';

export const COMPRESSION_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export type ConstraintStrength = 'hard' | 'soft';
export type ConstraintStatus = 'active' | 'superseded';

export interface ContextConstraint {
  id: string;
  /** Source message that introduced this constraint. */
  sourceMessageId?: string;
  status: ConstraintStatus;
  strength: ConstraintStrength;
  /** When superseded, the constraint id that replaced this one. */
  supersededBy?: string;
  /** When this constraint supersedes another. */
  supersedes?: string;
  /** Human-readable constraint text, preserved verbatim for hard constraints. */
  text: string;
}

export interface ContextDecision {
  confirmed?: boolean;
  id: string;
  sourceMessageId?: string;
  text: string;
}

export interface ContextOpenItem {
  blocked?: boolean;
  id: string;
  sourceMessageId?: string;
  text: string;
}

export interface ContextTechnicalFact {
  id: string;
  kind?: 'code' | 'path' | 'command' | 'asin' | 'site' | 'date' | 'file' | 'url' | 'other';
  sourceMessageId?: string;
  text: string;
}

/**
 * Versioned structured compression checkpoint.
 * Written to message_groups.metadata.snapshot; rendered Markdown stays in content.
 */
export interface CompressionSnapshotV2 {
  constraints: ContextConstraint[];
  decisions: ContextDecision[];
  openItems: ContextOpenItem[];
  overview: string;
  schemaVersion: typeof COMPRESSION_SNAPSHOT_SCHEMA_VERSION;
  /** Compression group ids merged into this checkpoint. */
  sourceGroupIds: string[];
  technicalFacts: ContextTechnicalFact[];
}

export const ContextConstraintSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  strength: z.enum(['hard', 'soft']),
  status: z.enum(['active', 'superseded']),
  sourceMessageId: z.string().optional(),
  supersededBy: z.string().optional(),
  supersedes: z.string().optional(),
});

export const ContextDecisionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceMessageId: z.string().optional(),
  confirmed: z.boolean().optional(),
});

export const ContextOpenItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  blocked: z.boolean().optional(),
  sourceMessageId: z.string().optional(),
});

export const ContextTechnicalFactSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z
    .enum(['code', 'path', 'command', 'asin', 'site', 'date', 'file', 'url', 'other'])
    .optional(),
  sourceMessageId: z.string().optional(),
});

export const CompressionSnapshotV2Schema = z.object({
  schemaVersion: z.literal(COMPRESSION_SNAPSHOT_SCHEMA_VERSION),
  overview: z.string(),
  constraints: z.array(ContextConstraintSchema).default([]),
  decisions: z.array(ContextDecisionSchema).default([]),
  openItems: z.array(ContextOpenItemSchema).default([]),
  technicalFacts: z.array(ContextTechnicalFactSchema).default([]),
  sourceGroupIds: z.array(z.string()).default([]),
});

export type CompressionSnapshotV2Input = z.input<typeof CompressionSnapshotV2Schema>;

/** Compression failure / degradation status stored on the group. */
export type CompressionDegradedReason =
  'parse_failed' | 'validation_repaired' | 'legacy_upgraded' | 'budget_trimmed';

export interface CompressionScope {
  agentId?: string;
  groupId?: string | null;
  threadId?: string | null;
  topicId?: string;
}
