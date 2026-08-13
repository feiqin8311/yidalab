import { AgentRuntimeErrorType } from '@lobechat/types';

export interface ModelEmptyCompletionDiagnostics {
  attempt?: number;
  contentLength?: number;
  finishReason?: string;
  imageCount?: number;
  maxAttempts?: number;
  model?: string;
  outputTokens?: number;
  provider?: string;
  reasoningLength?: number;
  retryBudget?: number;
  retryEvents?: Array<Record<string, unknown>>;
  toolCallCount?: number;
}

/**
 * Thrown when the model returns an empty completion — no user-visible text,
 * tool calls, or images. Hidden reasoning and token usage alone are not a
 * deliverable. This is the "empty
 * completion" failure mode: after a stalled tool loop the model effectively
 * gives up and emits a blank turn, which the harness used to silently finalize
 * to `done` while persisting an empty assistant message (empty bubble,
 * `status=done, error=null`).
 *
 * The `errorType` field tags it as the retryable `ModelEmptyCompletion` code
 * (see `errors/specs.ts`, which classifies it as a retryable `provider` error)
 * so that:
 *   1. an LLM-error classifier resolves it to `retry`, letting the agent's
 *      `call_llm` retry loop re-attempt the turn (a retry typically yields real
 *      content).
 *   2. If every retry is also empty, the terminal-error formatter enriches it
 *      into a readable, dashboard-visible error instead of a silent `done`.
 */
export class ModelEmptyError extends Error {
  readonly errorType = AgentRuntimeErrorType.ModelEmptyCompletion;
  readonly diagnostics?: ModelEmptyCompletionDiagnostics;

  constructor(
    message = 'Model returned an empty completion (no user-visible content or tool calls).',
    diagnostics?: ModelEmptyCompletionDiagnostics,
  ) {
    super(message);
    this.name = 'ModelEmptyError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Detect the "empty completion" failure mode: the model returns a turn with no
 * user-visible text, tool calls, or images — typically after a stalled tool
 * loop where it effectively gives up. Reasoning and output-token counters are
 * diagnostic only: providers can emit hidden reasoning without producing a
 * reply, so neither is proof of a deliverable. Callers throw
 * {@link ModelEmptyError} on a hit so the LLM retry loop re-attempts instead of
 * silently finalizing to `done` with a blank assistant message.
 */
export const isEmptyModelCompletion = (params: {
  content: string;
  imageCount: number;
  /** Diagnostic only; token usage is not proof of user-visible output. */
  outputTokens: number | undefined;
  /** Diagnostic only; hidden reasoning is not user-visible output. */
  reasoning: string;
  toolCallCount: number;
}): boolean => {
  const { content, toolCallCount, imageCount } = params;

  if (content.trim().length > 0) return false;
  if (toolCallCount > 0) return false;
  if (imageCount > 0) return false;

  return true;
};
