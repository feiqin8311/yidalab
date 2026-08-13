import type { AgentContextPolicy } from '@lobechat/agent-runtime';

/** Wall-clock deadline for a DingTalk / IM bot operation. */
export const BOT_DEADLINE_MS = 12 * 60 * 1000;

/**
 * Bot/IM context budget. Forced on every execAgent from AgentBridgeService so
 * a 12-tool SIF round cannot grow to 80k+ tokens before the next LLM call.
 * Raw tool payloads stay in Agent Document VFS via archiveToolResultIfNeeded.
 */
export const botContextPolicy: AgentContextPolicy = {
  budgets: {
    compressionRatio: 0.55,
    economicInputTokens: 72_000,
    maxHistoricalToolTokens: 24_000,
    maxHistoryTokens: 48_000,
    maxToolResultTokens: 6_000,
    maxToolRoundTokens: 16_000,
  },
  skillScope: { mode: 'inherit' },
  toolScope: { discovery: true, mode: 'inherit' },
};
