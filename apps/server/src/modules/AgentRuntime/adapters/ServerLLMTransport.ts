import type {
  BlobStore,
  ContextBuilder,
  LLMAttemptExecution,
  LLMAttemptInput,
  LLMStreamPayload,
  LLMStreamResult,
  LLMTransport,
  LLMTurnInput,
  LLMTurnSession,
} from '@lobechat/agent-runtime';
import {
  ACTIVE_MODEL_CANDIDATE_METADATA_KEY,
  resolveModelFailoverCandidates,
} from '@lobechat/agent-runtime';
import {
  type ChatStreamPayload,
  consumeStreamUntilDone,
  LLMStreamTimeoutError,
  type ModelRuntime,
} from '@lobechat/model-runtime';
import type { WorkingModel } from '@lobechat/types';

import { isModelAllowed } from '@/database/models/companyMemberQuota';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { CompanyQuotaService } from '@/server/services/companyQuota';
import type { ProviderConfig } from '@/types/user/settings';

import type { RuntimeExecutorContext } from '../context';
import {
  LLM_FIRST_CHUNK_TIMEOUT_MS,
  LLM_STREAM_IDLE_TIMEOUT_MS,
  LLM_TURN_TOTAL_TIMEOUT_MS,
  remainingDeadlineMs,
  withDeadline,
} from '../executorHelpers';
import { buildModelFailoverPool } from '../modelFailoverPool';
import { sortToolsForStablePrompt } from '../promptCache';
import { createServerCallLlmAttempt } from './serverCallLlmAttempt';
import { openServerCallLlmTurn } from './serverCallLlmExecutor';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return JSON.stringify(error);
};

/**
 * Server {@link LLMTransport} adapter — wraps model-runtime streaming and
 * returns the aggregated content/usage that package executors need.
 */
export class ServerLLMTransport implements LLMTransport {
  private readonly automaticFailoverPoolPromises = new Map<string, Promise<WorkingModel[]>>();
  private readonly modelRuntimePromises = new Map<string, Promise<ModelRuntime>>();
  private readonly preparedQuotaChecks = new Map<string, Promise<void>>();

  constructor(
    private readonly ctx: RuntimeExecutorContext,
    private readonly blobStore?: BlobStore,
    private readonly contextBuilder?: ContextBuilder,
  ) {}

  async prepare({ model, provider }: { model: string; provider: string }): Promise<void> {
    await Promise.all([this.prepareQuotaCheck(provider, model), this.getModelRuntime(provider)]);
  }

  async openTurn(input: LLMTurnInput): Promise<LLMTurnSession> {
    const activeCandidate = input.state.metadata?.[ACTIVE_MODEL_CANDIDATE_METADATA_KEY] as
      WorkingModel | undefined;
    const primary = { model: input.model, provider: input.provider };
    const initialCandidate =
      activeCandidate?.model?.trim() && activeCandidate.provider?.trim()
        ? { model: activeCandidate.model.trim(), provider: activeCandidate.provider.trim() }
        : primary;
    const prepareCandidate = async ({ model, provider }: WorkingModel) => {
      if (!this.contextBuilder) {
        throw new Error('ContextBuilder is required to prepare a model failover candidate');
      }

      const startedAt = Date.now();
      const [context] = await Promise.all([
        this.contextBuilder.build({
          model,
          payload: input.payload,
          provider,
          state: input.state,
        }),
        this.prepare({ model, provider }),
      ]);
      context.buildDurationMs = Date.now() - startedAt;
      return context;
    };
    const initialContext =
      initialCandidate.model === input.model && initialCandidate.provider === input.provider
        ? input.context
        : await prepareCandidate(initialCandidate);
    const loadCandidates = async () => {
      const automaticPool = await this.getAutomaticFailoverPool(
        primary,
        Boolean(input.context.resolvedTools?.tools.length),
      );
      const fallbacks =
        initialCandidate.model === primary.model && initialCandidate.provider === primary.provider
          ? automaticPool
          : [
              initialCandidate,
              ...automaticPool.filter(
                (candidate) =>
                  candidate.model !== initialCandidate.model ||
                  candidate.provider !== initialCandidate.provider,
              ),
            ];

      return resolveModelFailoverCandidates(primary, fallbacks, initialCandidate);
    };

    return openServerCallLlmTurn(this.ctx, {
      assistantMessage: input.assistantMessage,
      candidates: [initialCandidate],
      context: initialContext,
      loadCandidates,
      model: input.model,
      prepareCandidate,
      provider: input.provider,
      runAttempt: async (attemptInput) => {
        await this.assertQuota(attemptInput.provider, attemptInput.model);
        return this.runAttemptWithRuntime(
          attemptInput,
          await this.getModelRuntime(attemptInput.provider),
        );
      },
      state: input.state,
    });
  }

  async runAttempt(input: LLMAttemptInput): Promise<LLMAttemptExecution> {
    await this.assertQuota(input.provider, input.model);
    const modelRuntime = await this.getModelRuntime(input.provider);
    return this.runAttemptWithRuntime(input, modelRuntime);
  }

  async stream(
    payload: LLMStreamPayload,
    handlers?: Parameters<LLMTransport['stream']>[1],
  ): Promise<LLMStreamResult> {
    await this.assertQuota(payload.provider, payload.model);
    const runtime = await this.getModelRuntime(payload.provider);
    const { provider: _provider, ...runtimePayload } = payload;
    let content = '';
    let usage: LLMStreamResult['usage'];
    let streamError: unknown;

    const abort = new AbortController();
    const firstByteDeadlineAt = Date.now() + LLM_FIRST_CHUNK_TIMEOUT_MS;
    const turnDeadlineAt = Date.now() + LLM_TURN_TOTAL_TIMEOUT_MS;
    const firstByteTimeout = () => {
      abort.abort();
      return new LLMStreamTimeoutError('first_chunk', LLM_FIRST_CHUNK_TIMEOUT_MS);
    };
    const response = await withDeadline(
      runtime.chat(runtimePayload as any, {
        callback: {
          onCompletion: async (data: any) => {
            if (data.usage) usage = data.usage;
          },
          onError: async (errorData: unknown) => {
            streamError = errorData;
            handlers?.onError?.(errorData);
          },
          onText: async (text: string) => {
            content += text;
            handlers?.onText?.(text);
          },
        },
        signal: abort.signal,
        user: this.ctx.userId,
      }),
      remainingDeadlineMs(firstByteDeadlineAt),
      firstByteTimeout,
    );

    try {
      const remainingFirstByteMs = remainingDeadlineMs(firstByteDeadlineAt);
      if (remainingFirstByteMs <= 0) throw firstByteTimeout();

      await consumeStreamUntilDone(response, {
        firstChunkTimeoutMs: remainingFirstByteMs,
        idleTimeoutMs: LLM_STREAM_IDLE_TIMEOUT_MS,
        totalTimeoutMs: remainingDeadlineMs(turnDeadlineAt),
      });
    } catch (error) {
      abort.abort();
      throw error;
    }

    if (streamError) {
      throw new Error(getErrorMessage(streamError));
    }

    const result = { content, usage };
    handlers?.onFinish?.(result);
    return result;
  }

  private getModelRuntime(provider: string) {
    const existing = this.modelRuntimePromises.get(provider);
    if (existing) return existing;

    const runtimePromise = initModelRuntimeFromDB(
      this.ctx.serverDB,
      this.ctx.userId!,
      provider,
      this.ctx.workspaceId,
    ).catch((error) => {
      this.modelRuntimePromises.delete(provider);
      throw error;
    });
    this.modelRuntimePromises.set(provider, runtimePromise);
    return runtimePromise;
  }

  private assertQuota(provider: string, model: string) {
    if (!this.ctx.userId) return Promise.resolve();

    const cacheKey = `${provider}:${model}`;
    const prepared = this.preparedQuotaChecks.get(cacheKey);
    if (prepared) {
      this.preparedQuotaChecks.delete(cacheKey);
      return prepared;
    }

    return this.createQuotaCheck(provider, model);
  }

  private createQuotaCheck(provider: string, model: string) {
    if (!this.ctx.userId) return Promise.resolve();
    return new CompanyQuotaService(this.ctx.serverDB, this.ctx.userId).assertCanUseModel({
      model,
      provider,
      userId: this.ctx.userId,
    });
  }

  private prepareQuotaCheck(provider: string, model: string) {
    if (!this.ctx.userId) return Promise.resolve();

    const cacheKey = `${provider}:${model}`;
    const existing = this.preparedQuotaChecks.get(cacheKey);
    if (existing) return existing;

    const quotaPromise = this.createQuotaCheck(provider, model).catch((error) => {
      this.preparedQuotaChecks.delete(cacheKey);
      throw error;
    });
    this.preparedQuotaChecks.set(cacheKey, quotaPromise);
    return quotaPromise;
  }

  private getAutomaticFailoverPool(primary: WorkingModel, requiresFunctionCall: boolean) {
    const cacheKey = `${primary.provider}\0${primary.model}\0${requiresFunctionCall}`;
    const existing = this.automaticFailoverPoolPromises.get(cacheKey);
    if (existing) return existing;

    const poolPromise = this.loadAutomaticFailoverPool(primary, requiresFunctionCall).catch(
      (error) => {
        this.automaticFailoverPoolPromises.delete(cacheKey);
        console.error('[ServerLLMTransport] Failed to load automatic model failover pool:', error);
        return [];
      },
    );
    this.automaticFailoverPoolPromises.set(cacheKey, poolPromise);
    return poolPromise;
  }

  private async loadAutomaticFailoverPool(
    primary: WorkingModel,
    requiresFunctionCall: boolean,
  ): Promise<WorkingModel[]> {
    if (!this.ctx.userId) return [];

    const { aiProvider } = await getServerGlobalConfig();
    const repository = new AiInfraRepos(
      this.ctx.serverDB,
      this.ctx.userId,
      aiProvider as Record<string, ProviderConfig>,
      this.ctx.workspaceId,
    );
    const quotaService = new CompanyQuotaService(this.ctx.serverDB, this.ctx.userId);
    const [enabledModels, enabledProviders, quotaSnapshot] = await Promise.all([
      repository.getEnabledModels(),
      repository.getUserEnabledProviderList(),
      quotaService.getSnapshot(),
    ]);

    if (quotaSnapshot?.remainingCost === 0 && !quotaSnapshot.unlimited) return [];

    return buildModelFailoverPool({
      enabledModels,
      enabledProviderIds: enabledProviders.map(({ id }) => id),
      isAllowed: (candidate) =>
        isModelAllowed(quotaSnapshot?.allowedModels, candidate.provider, candidate.model),
      primary,
      requiresFunctionCall,
    });
  }

  private async runAttemptWithRuntime(
    input: LLMAttemptInput,
    modelRuntime: Pick<ModelRuntime, 'chat'>,
  ): Promise<LLMAttemptExecution> {
    const resolved = input.context.resolvedTools;
    if (!resolved) throw new Error('Resolved tools are required for a server LLM attempt');

    const tools = resolved.tools.length > 0 ? sortToolsForStablePrompt(resolved.tools) : undefined;
    const chatPayload = {
      messages: input.context.messages as ChatStreamPayload['messages'],
      model: input.model,
      stream: this.ctx.stream ?? true,
      tools,
      ...(input.context.modelParameters as Partial<ChatStreamPayload>),
      ...(typeof input.context.preserveThinking === 'boolean' && {
        preserveThinking: input.context.preserveThinking,
      }),
    };
    const operationLogId = `${this.ctx.operationId}:${this.ctx.stepIndex}`;
    const attempt = createServerCallLlmAttempt({
      attempt: input.attempt,
      blobStore: this.blobStore,
      chatPayload,
      ctx: this.ctx,
      events: input.events,
      maxAttempts: input.maxAttempts,
      messageCount: chatPayload.messages.length,
      model: input.model,
      modelRuntime,
      onFirstChunk: input.onFirstChunk ?? (() => {}),
      onFirstPublish: input.onFirstPublish ?? (() => {}),
      operationLogId,
      provider: input.provider,
      resolved,
      topicId: input.state.metadata?.topicId,
      trigger: input.state.metadata?.trigger,
    });

    try {
      await attempt.execute();
      return { ok: true, output: attempt.snapshot() };
    } catch (error) {
      attempt.clearBuffers();
      return { error, ok: false, output: attempt.snapshot() };
    }
  }
}
