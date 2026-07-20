import type { AgentState } from '../types';
import { recordToolFailOutcome } from './toolFailStreak';

const TOOL_FAIL_STREAKS_KEY = 'toolFailStreaks';
const RUN_BRAKE_REASON_KEY = 'runBrakeReason';

/**
 * After LLM usage is accumulated: force-finish when cumulative tokens hit the cap.
 * Caller still gets one tool-stripped summary turn via existing forceFinish flow.
 */
export const applyMaxTotalTokensBrake = (state: AgentState): AgentState => {
  const cap = state.maxTotalTokens;
  if (!cap || cap <= 0) return state;

  const total = state.usage?.llm?.tokens?.total ?? 0;
  if (total < cap) return state;

  state.forceFinish = true;
  state.metadata = {
    ...state.metadata,
    [RUN_BRAKE_REASON_KEY]: `Token limit reached: ${total} >= ${cap}`,
  };
  return state;
};

/**
 * After a tool result: track consecutive same-tool errors; force-finish at limit.
 */
export const applyToolFailStreakBrake = (
  state: AgentState,
  params: { errorMessage?: string; isSuccess: boolean; toolName: string },
): AgentState => {
  const limit = state.toolFailStreakLimit;
  if (!limit || limit <= 0) return state;

  const prev =
    (state.metadata?.[TOOL_FAIL_STREAKS_KEY] as Record<string, number> | undefined) ?? {};
  const outcome = recordToolFailOutcome({
    errorMessage: params.errorMessage,
    isSuccess: params.isSuccess,
    limit,
    streaks: prev,
    toolName: params.toolName,
  });

  state.metadata = {
    ...state.metadata,
    [TOOL_FAIL_STREAKS_KEY]: outcome.streaks,
    ...(outcome.forceFinish && outcome.reason ? { [RUN_BRAKE_REASON_KEY]: outcome.reason } : {}),
  };

  if (outcome.forceFinish) {
    state.forceFinish = true;
  }

  return state;
};

export const extractToolErrorMessage = (result: {
  content?: unknown;
  error?: unknown;
}): string | undefined => {
  if (typeof result.error === 'string' && result.error.trim()) return result.error;
  if (result.error && typeof result.error === 'object') {
    const msg = (result.error as { message?: string }).message;
    if (msg?.trim()) return msg;
  }
  if (typeof result.content === 'string' && result.content.trim()) {
    // Prefer short error-like content (MARKET_AUTH_REQUIRED, Command failed, …)
    const head = result.content.trim().slice(0, 200);
    if (/error|fail|required|denied|unauthorized|exception/i.test(head)) return head;
  }
  return undefined;
};
