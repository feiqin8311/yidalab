/**
 * YidaLab agent-run hard limits (step / token / tool-fail streak).
 *
 * Server is the source of truth for gateway ops; client path also reads these
 * so local/desktop runs share the same defaults.
 *
 * Env (optional):
 * - AGENT_MAX_STEPS (default 40)
 * - AGENT_MAX_TOTAL_TOKENS (default 500000)
 * - AGENT_TOOL_FAIL_STREAK (default 3)
 * - NEXT_PUBLIC_AGENT_MAX_STEPS / NEXT_PUBLIC_AGENT_MAX_TOTAL_TOKENS
 *   (client fallback when server env is not inlined)
 */

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const DEFAULT_AGENT_MAX_STEPS = 40;
export const DEFAULT_AGENT_MAX_TOTAL_TOKENS = 500_000;
export const DEFAULT_AGENT_TOOL_FAIL_STREAK = 3;

export interface AgentRunLimits {
  maxSteps: number;
  maxTotalTokens: number;
  toolFailStreak: number;
}

export const getAgentRunLimits = (): AgentRunLimits => {
  const maxSteps = parsePositiveInt(
    process.env.AGENT_MAX_STEPS ?? process.env.NEXT_PUBLIC_AGENT_MAX_STEPS,
    DEFAULT_AGENT_MAX_STEPS,
  );
  const maxTotalTokens = parsePositiveInt(
    process.env.AGENT_MAX_TOTAL_TOKENS ?? process.env.NEXT_PUBLIC_AGENT_MAX_TOTAL_TOKENS,
    DEFAULT_AGENT_MAX_TOTAL_TOKENS,
  );
  const toolFailStreak = parsePositiveInt(
    process.env.AGENT_TOOL_FAIL_STREAK ?? process.env.NEXT_PUBLIC_AGENT_TOOL_FAIL_STREAK,
    DEFAULT_AGENT_TOOL_FAIL_STREAK,
  );

  return { maxSteps, maxTotalTokens, toolFailStreak };
};

/** Normalize tool error text for streak keys (drop UUIDs / long noise). */
export const normalizeToolErrorSignature = (message: string | undefined): string => {
  if (!message?.trim()) return 'unknown';
  return message
    .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replaceAll(/\b[\da-f]{16,}\b/gi, '<hex>')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
};

export const toolFailStreakKey = (toolName: string, errorSignature: string): string =>
  `${toolName}::${errorSignature}`;
