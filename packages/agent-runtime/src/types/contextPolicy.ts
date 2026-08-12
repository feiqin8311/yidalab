/**
 * Run-level context policy for tool scope, skill scope, and token budgets.
 * Persisted on operation metadata; resume restores free.
 */

export type AgentToolScopeMode = 'inherit' | 'replace';
export type AgentSkillScopeMode = 'inherit' | 'replace' | 'none';

export interface AgentContextBudgets {
  /** Compression threshold ratio of context window (default 0.65 after prune). */
  compressionRatio?: number;
  /** Soft economic input before CompressionSnapshotV2 (default 96k). */
  economicInputTokens?: number;
  /** Max tokens for all historical tool bodies after prune (default 40k). */
  maxHistoricalToolTokens?: number;
  /** Max tokens for non-tool history window (default min(64k, 35% context)). */
  maxHistoryTokens?: number;
  /** Max tokens for a single tool result modelView (default 8k). */
  maxToolResultTokens?: number;
  /** Max tokens for all tool results in one round (default 20k). */
  maxToolRoundTokens?: number;
}

export interface AgentContextPolicy {
  budgets?: AgentContextBudgets;
  skillScope?: {
    allowedSkillNames?: string[];
    mode: AgentSkillScopeMode;
  };
  toolScope?: {
    /** Wire tool names (ToolNameResolver.generate). */
    allowedToolNames?: string[];
    /** When false, hide tool/skill discovery & activator. */
    discovery?: boolean;
    mode: AgentToolScopeMode;
  };
}

export const DEFAULT_CONTEXT_BUDGETS: Required<AgentContextBudgets> = {
  compressionRatio: 0.65,
  economicInputTokens: 96_000,
  maxHistoricalToolTokens: 40_000,
  maxHistoryTokens: 64_000,
  maxToolResultTokens: 8_000,
  maxToolRoundTokens: 20_000,
};

/** Chars-per-token used for budget ↔ length conversion (same as approxTokensFromText). */
export const CHARS_PER_TOKEN = 4;

export const resolveContextBudgets = (
  policy?: AgentContextPolicy | null,
): Required<AgentContextBudgets> => ({
  ...DEFAULT_CONTEXT_BUDGETS,
  ...policy?.budgets,
});

export const resolveMaxHistoryTokens = (
  budgets: Required<AgentContextBudgets>,
  contextWindow?: number,
): number => {
  if (!contextWindow || contextWindow <= 0) return budgets.maxHistoryTokens;
  return Math.min(budgets.maxHistoryTokens, Math.floor(contextWindow * 0.35));
};

export const resolveEconomicInputTokens = (
  budgets: Required<AgentContextBudgets>,
  contextWindow?: number,
): number => {
  if (!contextWindow || contextWindow <= 0) return budgets.economicInputTokens;
  return Math.min(
    budgets.economicInputTokens,
    Math.floor(contextWindow * budgets.compressionRatio),
  );
};

export const defaultInheritContextPolicy = (): AgentContextPolicy => ({
  budgets: { ...DEFAULT_CONTEXT_BUDGETS },
  skillScope: { mode: 'inherit' },
  toolScope: { discovery: true, mode: 'inherit' },
});

/** Cap for sub-agent → parent structured summary (tokens). */
export const DEFAULT_SUBAGENT_RETURN_TOKENS = 4_000;

export const defaultReplaceContextPolicy = (opts: {
  allowedSkillNames?: string[];
  allowedToolNames: string[];
}): AgentContextPolicy => ({
  budgets: { ...DEFAULT_CONTEXT_BUDGETS },
  skillScope: {
    allowedSkillNames: opts.allowedSkillNames ?? [],
    mode: opts.allowedSkillNames?.length ? 'replace' : 'none',
  },
  toolScope: {
    allowedToolNames: opts.allowedToolNames,
    discovery: false,
    mode: 'replace',
  },
});
