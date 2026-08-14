import {
  type AgentState,
  type ContextBuildOutput,
  type LLMAttemptOutput,
  type LLMTransport,
  type LLMTurnAttemptInput,
  type LLMTurnErrorInput,
  type LLMTurnFailoverInput,
  type LLMTurnRetryInput,
  type LLMTurnSession,
  MAX_MODEL_FAILOVER_CANDIDATES,
  resolveLLMMaxAttempts,
  resolveLLMRetryBudget,
  shouldFailoverModel,
} from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { LLMStreamTimeoutError, ModelEmptyError } from '@lobechat/model-runtime';
import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
} from '@lobechat/observability-otel/api';
import {
  buildChatRequestAttributes,
  buildChatResponseAttributes,
  chatSpanName,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import type { WorkingModel } from '@lobechat/types';

import { CompanyQuotaDeniedError } from '@/server/services/companyQuota';

import { type RuntimeExecutorContext } from '../context';
import { log, sleep } from '../executorHelpers';
import { classifyLLMError } from '../llmErrorClassification';
import { createPromptFingerprint, sortToolsForStablePrompt } from '../promptCache';

interface ServerCallLlmExecutionContext {
  assistantMessage: { id: string };
  candidates: WorkingModel[];
  context: ContextBuildOutput;
  loadCandidates: () => Promise<WorkingModel[]>;
  model: string;
  prepareCandidate: (candidate: WorkingModel) => Promise<ContextBuildOutput>;
  provider: string;
  runAttempt: NonNullable<LLMTransport['runAttempt']>;
  state: AgentState;
}

const SERVER_LLM_RETRY_POLICY = {
  isEmptyCompletionError: (error: unknown) => error instanceof ModelEmptyError,
  isStreamTimeoutError: (error: unknown) => error instanceof LLMStreamTimeoutError,
  noRetryProviders: [BRANDING_PROVIDER],
  streamTimeoutMaxRetries: 1,
};

class ServerCallLlmTurnSession implements LLMTurnSession {
  readonly maxAttempts: number;

  private readonly chatContext: ReturnType<typeof otelTrace.setSpan>;
  private readonly chatSpan: ReturnType<typeof agentRuntimeTracer.startSpan>;
  private candidates: WorkingModel[];
  private candidatesLoaded = false;
  private currentCandidateIndex = 0;
  private currentContext: ContextBuildOutput;
  private firstChunkAt?: number;
  private firstPublishAt?: number;
  private readonly llmStartTime = Date.now();
  private readonly operationLogId: string;

  constructor(
    private readonly ctx: RuntimeExecutorContext,
    private readonly prepared: ServerCallLlmExecutionContext,
  ) {
    const currentCandidate = prepared.candidates[0] ?? {
      model: prepared.model,
      provider: prepared.provider,
    };
    const { context, state } = prepared;
    const { model, provider } = currentCandidate;
    const processedMessages = context.messages as Array<{ role?: string }>;
    this.currentContext = context;
    this.candidates = prepared.candidates;

    if (!context.resolvedTools) {
      throw new Error('Resolved tools are required for a server LLM turn');
    }
    if (!processedMessages.some((message) => message.role !== 'system')) {
      throw new Error(
        `call_llm produced no non-system messages for ${provider}/${model} ` +
          `(topic=${state.metadata?.topicId ?? 'n/a'}, step=${ctx.stepIndex}); refusing to dispatch`,
      );
    }

    this.operationLogId = `${ctx.operationId}:${ctx.stepIndex}`;
    this.maxAttempts =
      resolveLLMMaxAttempts(provider, SERVER_LLM_RETRY_POLICY) + MAX_MODEL_FAILOVER_CANDIDATES;
    log(
      '[%s][call_llm] Starting operation with prepared assistant message: %s',
      this.operationLogId,
      prepared.assistantMessage.id,
    );

    this.chatSpan = agentRuntimeTracer.startSpan(chatSpanName(model), {
      attributes: buildChatRequestAttributes({
        conversationId: state.metadata?.topicId,
        operationId: ctx.operationId,
        provider,
        requestModel: model,
        stepIndex: ctx.stepIndex,
        stream: ctx.stream ?? true,
      }),
      kind: SpanKind.CLIENT,
    });
    this.chatSpan.setAttributes({
      ...(context.buildDurationMs === undefined
        ? {}
        : { 'lobehub.context.build_duration_ms': context.buildDurationMs }),
      'lobehub.prompt.fingerprint': createPromptFingerprint({
        messages: context.messages,
        tools: sortToolsForStablePrompt(context.resolvedTools.tools),
      }),
      'lobehub.prompt.message_count': processedMessages.length,
      'lobehub.prompt.tool_count': context.resolvedTools.tools.length,
    });
    this.chatContext = otelTrace.setSpan(otelContext.active(), this.chatSpan);
  }

  classifyError(error: unknown) {
    return classifyLLMError(error);
  }

  getCurrentCandidate() {
    return (
      this.candidates[this.currentCandidateIndex] ?? {
        model: this.prepared.model,
        provider: this.prepared.provider,
      }
    );
  }

  close(error?: unknown) {
    if (error) {
      this.chatSpan.recordException(error as Error);
      this.chatSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    this.chatSpan.end();
  }

  async handleError({ error, events, retryBudget }: LLMTurnErrorInput) {
    await otelContext.with(this.chatContext, async () => {
      if (error instanceof ModelEmptyError && error.diagnostics) {
        error.diagnostics.retryBudget = retryBudget;
        error.diagnostics.retryEvents = events
          .filter((event) => event.type === 'stream_retry')
          .map((event) => event.data);
      }

      console.error(
        `[StreamingLLMExecutor][${this.ctx.operationId}:${this.ctx.stepIndex}] LLM execution failed:`,
        error,
      );
    });
  }

  resolveRetryBudget(error: unknown) {
    if (error instanceof CompanyQuotaDeniedError) return 0;
    if (this.currentCandidateIndex > 0) return 0;
    return resolveLLMRetryBudget(
      this.getCurrentCandidate().provider,
      error,
      SERVER_LLM_RETRY_POLICY,
    );
  }

  onRetry({ attempt, delayMs, error, maxAttempts }: LLMTurnRetryInput) {
    log(
      '[%s] LLM call failed with kind=%s (attempt %d/%d), retrying in %dms ...',
      this.operationLogId,
      error.kind,
      attempt,
      maxAttempts,
      delayMs,
    );
  }

  recordResult(output: LLMAttemptOutput) {
    return otelContext.with(this.chatContext, () => {
      const candidate = this.getCurrentCandidate();
      log('[%s] call_llm completed', this.operationLogId);
      this.chatSpan.setAttributes({
        'lobehub.llm.effective_model': candidate.model,
        'lobehub.llm.effective_provider': candidate.provider,
        'lobehub.llm.failover_count': this.currentCandidateIndex,
      });
      this.chatSpan.setAttributes(
        buildChatResponseAttributes({
          cacheReadInputTokens: output.usage?.inputCachedTokens,
          finishReasons: output.finishReason ? [output.finishReason] : undefined,
          inputTokens: output.usage?.totalInputTokens,
          outputTokens: output.usage?.totalOutputTokens,
          reasoningOutputTokens: output.usage?.outputReasoningTokens,
          timeToFirstChunkMs: this.firstChunkAt,
        }),
      );
      if (this.firstPublishAt !== undefined) {
        this.chatSpan.setAttribute('lobehub.llm.gateway_first_publish_ms', this.firstPublishAt);
      }
      if (output.usage?.inputCachedTokens !== undefined && output.usage.totalInputTokens) {
        this.chatSpan.setAttribute(
          'lobehub.prompt.cache_hit_ratio',
          output.usage.inputCachedTokens / output.usage.totalInputTokens,
        );
      }
    });
  }

  runAttempt({ attempt, events }: LLMTurnAttemptInput) {
    const candidate = this.getCurrentCandidate();
    return otelContext.with(this.chatContext, () =>
      this.prepared.runAttempt({
        attempt,
        context: this.currentContext,
        events,
        maxAttempts:
          this.currentCandidateIndex === 0
            ? resolveLLMMaxAttempts(candidate.provider, SERVER_LLM_RETRY_POLICY)
            : 1,
        model: candidate.model,
        onFirstChunk: () => {
          if (this.firstChunkAt === undefined) {
            this.firstChunkAt = Date.now() - this.llmStartTime;
          }
        },
        onFirstPublish: () => {
          if (this.firstPublishAt === undefined) {
            this.firstPublishAt = Date.now() - this.llmStartTime;
          }
        },
        provider: candidate.provider,
        state: this.prepared.state,
      }),
    );
  }

  async tryFailover({ error, errorInfo }: LLMTurnFailoverInput) {
    const isModelAccessDenied =
      error instanceof CompanyQuotaDeniedError && error.reason === 'model_not_allowed';
    if (!isModelAccessDenied && !shouldFailoverModel(errorInfo)) return;

    const from = this.getCurrentCandidate();
    if (!this.candidatesLoaded) {
      const loadedCandidates = await this.prepared.loadCandidates();
      this.candidatesLoaded = true;
      if (loadedCandidates.length > 0) {
        this.candidates = loadedCandidates;
        const currentIndex = loadedCandidates.findIndex(
          (candidate) => candidate.model === from.model && candidate.provider === from.provider,
        );
        this.currentCandidateIndex = Math.max(0, currentIndex);
      }
    }

    for (let index = this.currentCandidateIndex + 1; index < this.candidates.length; index++) {
      const to = this.candidates[index];

      try {
        const context = await this.prepared.prepareCandidate(to);
        const processedMessages = context.messages as Array<{ role?: string }>;
        if (
          !context.resolvedTools ||
          !processedMessages.some((message) => message.role !== 'system')
        ) {
          throw new Error(`Failover context is invalid for ${to.provider}/${to.model}`);
        }

        this.currentCandidateIndex = index;
        this.currentContext = context;
        this.chatSpan.addEvent('llm.model_failover', {
          'llm.failover.from_model': from.model,
          'llm.failover.from_provider': from.provider,
          'llm.failover.reason': errorInfo.code ?? errorInfo.message,
          'llm.failover.to_model': to.model,
          'llm.failover.to_provider': to.provider,
        });
        log(
          '[%s] Failing over model %s/%s -> %s/%s after %s',
          this.operationLogId,
          from.provider,
          from.model,
          to.provider,
          to.model,
          errorInfo.code ?? errorInfo.kind,
        );

        return {
          candidateIndex: index + 1,
          from,
          to,
          totalCandidates: this.candidates.length,
        };
      } catch (error) {
        const candidateError = classifyLLMError(error);
        this.chatSpan.addEvent('llm.failover_candidate_unavailable', {
          'llm.failover.candidate_model': to.model,
          'llm.failover.candidate_provider': to.provider,
          'llm.failover.error': candidateError.code ?? candidateError.message,
        });
        console.error(
          `[StreamingLLMExecutor][${this.operationLogId}] Failed to prepare fallback ${to.provider}/${to.model}:`,
          error,
        );
        if (!shouldFailoverModel(candidateError)) throw error;
      }
    }
  }

  async waitForRetry(delayMs: number): Promise<void> {
    await sleep(delayMs);
  }
}

export const openServerCallLlmTurn = (
  ctx: RuntimeExecutorContext,
  prepared: ServerCallLlmExecutionContext,
): LLMTurnSession => new ServerCallLlmTurnSession(ctx, prepared);
