/**
 * Operation-local tool failure streak tracking for run brakes.
 */

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

export interface ToolFailStreakState {
  /** Per tool+error consecutive failure counts */
  streaks: Record<string, number>;
}

export interface RecordToolFailOutcomeResult {
  forceFinish: boolean;
  reason?: string;
  streaks: Record<string, number>;
}

/**
 * Update streak map after a tool call. Success clears keys for that tool prefix.
 * Failure increments the signature key; at `limit` returns forceFinish.
 */
export const recordToolFailOutcome = (params: {
  errorMessage?: string;
  isSuccess: boolean;
  limit: number;
  streaks?: Record<string, number>;
  toolName: string;
}): RecordToolFailOutcomeResult => {
  const streaks = { ...params.streaks };
  const toolPrefix = `${params.toolName}::`;

  if (params.isSuccess) {
    for (const key of Object.keys(streaks)) {
      if (key.startsWith(toolPrefix)) delete streaks[key];
    }
    return { forceFinish: false, streaks };
  }

  const signature = normalizeToolErrorSignature(params.errorMessage);
  const key = toolFailStreakKey(params.toolName, signature);
  const next = (streaks[key] ?? 0) + 1;
  streaks[key] = next;

  if (next >= params.limit) {
    return {
      forceFinish: true,
      reason: `Tool failed ${next} times in a row (${params.toolName}: ${signature}). Stopping to avoid further token burn.`,
      streaks,
    };
  }

  return { forceFinish: false, streaks };
};
