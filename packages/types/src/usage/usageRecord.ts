import type { MessageMetadata } from '../message';

export interface UsageRecordItem {
  createdAt: Date;
  /**
   * ID
   **/
  id: string;
  inputStartAt?: Date | null;
  /**
   * Meta information
   **/
  metadata?: MessageMetadata | null;
  /**
   * Model id
   */
  model: string;
  outputFinishAt?: Date | null;
  outputStartAt?: Date | null;
  /**
   * Provider id
   */
  provider: string;
  /**
   * Spend
   **/
  spend: number;
  /**
   * Usage details
   **/
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalTokens?: number | null;
  /**
   * Performance details
   **/
  tps?: number | null;
  ttft?: number | null;
  /**
   * Call types
   **/
  type: string;
  updatedAt: Date;
  userId: string;
}

export type UsageLog = {
  date: number;
  day: string;
  records: UsageRecordItem[];
  totalRequests: number;
  totalSpend: number;
  totalTokens: number;
};

/** Time granularity for the agent usage chart buckets. */
export type AgentUsageGranularity = 'day' | 'week';

/**
 * One bar in the agent usage trend chart. Cost components are reconciled to the
 * authoritative billed cost; token components are the raw reported counts.
 * Cached and uncached input are kept separate so the chart reflects their
 * different rates.
 */
export interface AgentUsageBucket {
  cachedInputCost: number;
  cachedInputTokens: number;
  cacheWriteCost: number;
  cacheWriteTokens: number;
  /** Bucket start timestamp (ms), for stable sorting. */
  date: number;
  inputCost: number;
  inputTokens: number;
  /** Display label, e.g. "5/25" (day) or week-start "5/25" (week). */
  label: string;
  outputCost: number;
  outputTokens: number;
  totalCost: number;
}

export interface AgentUsageModelRow {
  cost: number;
  id: string;
  model: string;
  provider: string;
  requests: number;
  totalTokens: number;
}

export interface AgentUsageStats {
  buckets: AgentUsageBucket[];
  byModel: AgentUsageModelRow[];
  summary: {
    cacheHitRate: number;
    cacheReadTokens: number;
    cacheSavings: number;
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    totalRequests: number;
    totalTokens: number;
  };
}

/** One tool identifier row in workspace tool/skill usage stats. */
export interface ToolUsageToolRow {
  calls: number;
  failed: number;
  identifier: string;
}

/** activateSkill breakdown by skill name (from tool arguments). */
export interface ToolUsageSkillRow {
  activations: number;
  failed: number;
  name: string;
}

/** Per-user tool call totals (admin/owner dimension). */
export interface ToolUsageUserRow {
  calls: number;
  failed: number;
  userId: string;
}

/** API-level detail under tools (identifier + apiName). */
export interface ToolUsageApiRow {
  apiName: string;
  calls: number;
  failed: number;
  identifier: string;
}

/**
 * Aggregated tool / skill call stats from message_plugins.
 * Counts explicit tool invocations only (not silent skill pin injection).
 */
export interface ToolUsageStats {
  byApi: ToolUsageApiRow[];
  bySkill: ToolUsageSkillRow[];
  byTool: ToolUsageToolRow[];
  byUser: ToolUsageUserRow[];
  summary: {
    companyMcpCalls: number;
    failedCalls: number;
    skillActivations: number;
    totalCalls: number;
  };
}
