import type { ToolRunContext, ToolRunExecution, ToolTransport } from '@lobechat/agent-runtime';
import { executeToolWithRetry } from '@lobechat/agent-runtime';
import {
  buildDedupHitContent,
  buildToolCacheKey,
  cloneToolResultCache,
  ensureToolResultCache,
  isToolCacheable,
  lookupToolCache,
  resolveToolCacheHint,
  type ToolResultCacheIndex,
  writeToolCache,
} from '@lobechat/context-engine';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildExecuteToolAttributes,
  buildExecuteToolResultAttributes,
  executeToolSpanName,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { isDeviceCapablePlan } from '@/helpers/executionTarget';
import type { DeviceAccessReason } from '@/server/services/aiAgent/deviceToolAudit';
import {
  isDeviceToolIdentifier,
  logDeviceToolAudit,
} from '@/server/services/aiAgent/deviceToolAudit';

import type { RuntimeExecutorContext } from '../context';
import { dispatchClientTool } from '../dispatchClientTool';
import {
  archiveRuntimeToolResult,
  buildServerAgentMemberRunner,
  buildServerVirtualSubAgentRunner,
  GEN_AI_FUNCTION_TOOL_TYPE,
  isOperationInterrupted,
  log,
  TOOL_MAX_RETRIES,
  TOOL_PRICING,
} from '../executorHelpers';
import { resolveRunActiveDeviceId } from '../executors/resolveRunActiveDeviceId';
import { resolveRunProjectSkills } from '../executors/resolveRunProjectSkills';
import { resolveToolTimeoutMs } from '../resolveToolTimeout';

export class ServerToolTransport implements ToolTransport {
  maxRetries = TOOL_MAX_RETRIES;

  /** Coalesces concurrent identical read-only calls in the same Promise.all batch. */
  private readonly readOnlyInflight = new Map<string, Promise<ToolRunExecution>>();

  constructor(private readonly ctx: RuntimeExecutorContext) {}

  getCost(toolName: string) {
    return TOOL_PRICING[toolName] || 0;
  }

  async handleError(
    chatToolPayload: ChatToolPayload,
    error: unknown,
    context: ToolRunContext,
  ): Promise<void> {
    const { hookDispatcher, operationId, stepIndex, userId } = this.ctx;

    if (hookDispatcher) {
      hookDispatcher
        .dispatch(
          operationId,
          'onToolCallError',
          {
            apiName: chatToolPayload.apiName,
            args: context.parsedArgs,
            callIndex: context.callIndex,
            error: error instanceof Error ? error.message : String(error),
            identifier: chatToolPayload.identifier,
            operationId,
            stepIndex,
            userId,
          },
          context.state.metadata?._hooks,
        )
        .catch(() => {});
    }

    console.error(
      `[StreamingToolExecutor] Tool execution failed for operation ${operationId}:${stepIndex}:`,
      error,
    );
  }

  async run(chatToolPayload: ChatToolPayload, context: ToolRunContext): Promise<ToolRunExecution> {
    const { operationId, serverDB, stepIndex, streamManager, toolExecutionService, userId } =
      this.ctx;
    const operationLogId = `${operationId}:${stepIndex}`;
    const executeToolSpan = agentRuntimeTracer.startSpan(executeToolSpanName(context.toolName), {
      attributes: buildExecuteToolAttributes({
        operationId,
        stepIndex,
        toolCallId: chatToolPayload.id,
        toolName: context.toolName,
        toolSource: context.toolSource,
        toolType: GEN_AI_FUNCTION_TOOL_TYPE,
      }),
    });

    let inflightLead:
      | { key: string; reject: (e: unknown) => void; resolve: (v: ToolRunExecution) => void }
      | undefined;

    try {
      const hookResult = await this.dispatchBeforeToolCall(chatToolPayload, context);
      let toolCallMocked = false;

      if (isDeviceToolIdentifier(chatToolPayload.identifier) && !hookResult?.isMocked) {
        const policy = context.state.metadata?.deviceAccessPolicy as
          { canUseDevice: boolean; reason: DeviceAccessReason } | undefined;
        logDeviceToolAudit({
          apiName: chatToolPayload.apiName,
          botContext: context.state.metadata?.botContext,
          canUseDevice: policy?.canUseDevice ?? true,
          messageId: context.state.metadata?.sourceMessageId,
          operationId,
          reason: policy?.reason ?? 'first-party',
          toolIdentifier: chatToolPayload.identifier,
          topicId: this.ctx.topicId,
          userId,
        });
      }

      // Hook mock wins over dedup so tests / interventions still control the path.
      // Dedup only applies to real re-executions of read-only tools.
      let execution: ToolRunExecution | undefined;
      if (hookResult?.isMocked) {
        log(`[${operationLogId}] Tool ${context.toolName} mocked by beforeToolCall hook`);
        toolCallMocked = true;
        execution = {
          attempts: 0,
          mocked: true,
          result: { content: hookResult.content, executionTime: 0, success: true },
        };
      } else {
        const dedupHit = this.tryReadOnlyDedup(chatToolPayload, context);
        if (dedupHit) {
          executeToolSpan.setAttributes(
            buildExecuteToolResultAttributes({ attempts: 0, success: true }),
          );
          // Still fire afterToolCall so observers see the hit
          await this.dispatchAfterToolCall(chatToolPayload, context, dedupHit, false);
          return {
            attempts: 0,
            mocked: false,
            result: dedupHit,
          };
        }

        // Register before any await so Promise.all siblings join instead of all missing.
        const inflight = this.beginReadOnlyInflight(chatToolPayload, context);
        if (inflight.kind === 'follow') {
          const shared = await inflight.promise;
          const hit = this.tryReadOnlyDedup(chatToolPayload, context);
          const result = hit ?? shared.result;
          executeToolSpan.setAttributes(
            buildExecuteToolResultAttributes({ attempts: 0, success: result.success }),
          );
          await this.dispatchAfterToolCall(chatToolPayload, context, result, false);
          return { attempts: 0, mocked: false, result };
        }
        if (inflight.kind === 'lead') inflightLead = inflight;
      }

      if (!execution) {
        if (
          chatToolPayload.executor === 'client' &&
          typeof streamManager.sendToolExecute === 'function'
        ) {
          log(
            `[${operationLogId}] Dispatching tool ${context.toolName} to client via Agent Gateway`,
          );
          const timeoutMs = resolveToolTimeoutMs({
            apiName: chatToolPayload.apiName,
            args: context.parsedArgs,
            manifest: context.effectiveManifestMap[chatToolPayload.identifier],
          });
          const dispatchResult = await dispatchClientTool(chatToolPayload, {
            operationId,
            streamManager,
            timeoutMs,
          });
          execution = { attempts: 1, result: dispatchResult };
        } else {
          if (context.toolSource && !chatToolPayload.source) {
            chatToolPayload.source = context.toolSource as any;
          }

          const timeoutMs = resolveToolTimeoutMs({
            apiName: chatToolPayload.apiName,
            args: context.parsedArgs,
            manifest: context.effectiveManifestMap[chatToolPayload.identifier],
          });
          const agentVisibility = await this.resolveAgentVisibility(context);

          log(`[${operationLogId}] Executing tool ${context.toolName} ...`);
          execution = await executeToolWithRetry(
            () =>
              toolExecutionService.executeTool(chatToolPayload, {
                activatedSkills: context.activatedSkills as any,
                activeDeviceId: resolveRunActiveDeviceId(context.state.metadata),
                activeDeviceScope: context.state.metadata?.activeDeviceScope,
                agentId: context.state.metadata?.agentId,
                botContext: context.state.metadata?.botContext ?? this.ctx.botContext,
                agentMember: buildServerAgentMemberRunner(
                  this.ctx,
                  context.state,
                  chatToolPayload,
                  context.parentMessageId,
                ),
                ...(agentVisibility !== undefined && { agentVisibility }),
                assistantMessageId: context.parentMessageId,
                deviceCapable: context.state.metadata?.executionPlan
                  ? isDeviceCapablePlan(context.state.metadata.executionPlan)
                  : undefined,
                documentId: context.state.metadata?.documentId,
                enabledAgentDocumentIds:
                  context.state.metadata?.agentConfig?.chatConfig?.enabledAgentDocumentIds,
                editingAgentId: context.state.metadata?.editingAgentId,
                execSubAgent: this.ctx.execSubAgent,
                executionTimeoutMs: timeoutMs,
                groupId: context.state.metadata?.groupId,
                isSubAgent: context.state.metadata?.isSubAgent === true,
                memoryToolPermission:
                  context.state.metadata?.agentConfig?.chatConfig?.memory?.toolPermission,
                messageId: context.state.metadata?.sourceMessageId,
                operationId,
                projectSkills: resolveRunProjectSkills(context.state.metadata),
                scope: context.state.metadata?.scope,
                serverDB,
                skipResultTruncation: true,
                subAgent: buildServerVirtualSubAgentRunner(
                  this.ctx,
                  context.state,
                  chatToolPayload,
                  context.parentMessageId,
                ),
                taskId: context.state.metadata?.taskId,
                threadId: context.state.metadata?.threadId,
                toolCallId: chatToolPayload.id,
                toolManifestMap: context.effectiveManifestMap,
                toolResultMaxLength: context.toolResultMaxLength,
                topicId: this.ctx.topicId,
                userId,
                workingDirectory: context.state.metadata?.deviceSystemInfo?.workingDirectory,
                workspaceId: context.state.metadata?.workspaceId ?? this.ctx.workspaceId,
              }),
            {
              isInterrupted: () => isOperationInterrupted(this.ctx),
              maxRetries: TOOL_MAX_RETRIES,
              onRetry: ({ attempt, kind, maxAttempts }) =>
                log(
                  '[%s] Tool %s failed with kind=%s (attempt %d/%d), retrying ...',
                  operationLogId,
                  context.toolName,
                  kind,
                  attempt,
                  maxAttempts,
                ),
            },
          );
        }
      }

      if (!execution) {
        throw new Error(
          `[StreamingToolExecutor] Tool execution not assigned for ${context.toolName}`,
        );
      }

      if (execution.result.deferred) {
        // Client-wait results are per tool_call_id — don't share the slot.
        if (inflightLead) this.readOnlyInflight.delete(inflightLead.key);
        executeToolSpan.setAttributes(
          buildExecuteToolResultAttributes({ attempts: execution.attempts, success: true }),
        );
        return { ...execution, mocked: toolCallMocked || execution.mocked };
      }

      const resultWithExecutionTime = {
        ...execution.result,
        executionTime: execution.result.executionTime ?? 0,
      };
      const policyBudgets = context.state.metadata?.contextPolicy?.budgets as
        { maxToolResultTokens?: number } | undefined;
      const executionResult = await archiveRuntimeToolResult(resultWithExecutionTime, {
        agentId: context.state.metadata?.agentId,
        identifier: chatToolPayload.identifier,
        limit: context.toolResultMaxLength,
        maxToolResultTokens: policyBudgets?.maxToolResultTokens,
        serverDB,
        toolCallId: chatToolPayload.id,
        topicId: this.ctx.topicId ?? context.state.metadata?.topicId,
        userId,
        workspaceId: context.state.metadata?.workspaceId ?? this.ctx.workspaceId,
      });

      this.rememberReadOnlyResult(chatToolPayload, context, executionResult);

      await this.dispatchAfterToolCall(chatToolPayload, context, executionResult, toolCallMocked);

      executeToolSpan.setAttributes(
        buildExecuteToolResultAttributes({
          attempts: execution.attempts,
          success: executionResult.success,
        }),
      );

      const completed: ToolRunExecution = {
        ...execution,
        mocked: toolCallMocked || execution.mocked,
        result: executionResult,
      };
      inflightLead?.resolve(completed);
      return completed;
    } catch (error) {
      inflightLead?.reject(error);
      executeToolSpan.recordException(error as Error);
      executeToolSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      executeToolSpan.setAttributes(buildExecuteToolResultAttributes({ success: false }));
      throw error;
    } finally {
      if (inflightLead) this.readOnlyInflight.delete(inflightLead.key);
      executeToolSpan.end();
    }
  }

  private async dispatchBeforeToolCall(chatToolPayload: ChatToolPayload, context: ToolRunContext) {
    const { hookDispatcher, operationId, stepIndex, userId } = this.ctx;
    if (!hookDispatcher) return null;

    hookDispatcher
      .dispatch(
        operationId,
        'beforeToolCall',
        {
          apiName: chatToolPayload.apiName,
          args: context.parsedArgs,
          callIndex: context.callIndex,
          identifier: chatToolPayload.identifier,
          operationId,
          stepIndex,
          userId,
        },
        context.state.metadata?._hooks,
      )
      .catch(() => {});

    return hookDispatcher.dispatchBeforeToolCall(operationId, {
      apiName: chatToolPayload.apiName,
      args: context.parsedArgs,
      callIndex: context.callIndex,
      identifier: chatToolPayload.identifier,
      stepIndex,
    });
  }

  private async dispatchAfterToolCall(
    chatToolPayload: ChatToolPayload,
    context: ToolRunContext,
    result: ToolRunExecution['result'],
    mocked: boolean,
  ) {
    const { hookDispatcher, operationId, stepIndex, userId } = this.ctx;
    if (!hookDispatcher) return;

    hookDispatcher
      .dispatch(
        operationId,
        'afterToolCall',
        {
          apiName: chatToolPayload.apiName,
          args: context.parsedArgs,
          callIndex: context.callIndex,
          content: result.content,
          executionTimeMs: result.executionTime ?? 0,
          identifier: chatToolPayload.identifier,
          mocked,
          operationId,
          stepIndex,
          success: result.success,
          userId,
        },
        context.state.metadata?._hooks,
      )
      .catch(() => {});
  }

  private async resolveAgentVisibility(context: ToolRunContext) {
    if (context.mode !== 'single') return undefined;

    const agentId = context.state.metadata?.agentId;
    const workspaceId = context.state.metadata?.workspaceId ?? this.ctx.workspaceId;
    if (!agentId || !this.ctx.serverDB || !this.ctx.userId) return null;

    try {
      const agentModel = new AgentModel(this.ctx.serverDB, this.ctx.userId, workspaceId);
      return await agentModel.getAgentVisibility(agentId);
    } catch (error) {
      log(
        `[${this.ctx.operationId}:${this.ctx.stepIndex}] Failed to resolve agent visibility: %O`,
        error,
      );
      return null;
    }
  }

  private resolveCacheHint(chatToolPayload: ChatToolPayload, context: ToolRunContext) {
    return resolveToolCacheHint({
      apiName: chatToolPayload.apiName,
      identifier: chatToolPayload.identifier,
      manifest: context.effectiveManifestMap?.[chatToolPayload.identifier],
    });
  }

  private getToolResultCache(context: ToolRunContext): ToolResultCacheIndex {
    if (!context.state.metadata) context.state.metadata = {};
    // Clone so write/lookup never mutate an Immer-frozen persist snapshot.
    const cache = cloneToolResultCache(
      ensureToolResultCache(context.state.metadata.toolResultCache),
    );
    context.state.metadata.toolResultCache = cache;
    return cache;
  }

  private beginReadOnlyInflight(
    chatToolPayload: ChatToolPayload,
    context: ToolRunContext,
  ):
    | { kind: 'follow'; promise: Promise<ToolRunExecution> }
    | {
        kind: 'lead';
        key: string;
        reject: (e: unknown) => void;
        resolve: (v: ToolRunExecution) => void;
      }
    | { kind: 'skip' } {
    // Client dispatch can return deferred per tool_call_id — don't coalesce those.
    if (chatToolPayload.executor === 'client') return { kind: 'skip' };
    const hint = this.resolveCacheHint(chatToolPayload, context);
    if (!isToolCacheable(hint)) return { kind: 'skip' };

    const key = buildToolCacheKey(
      chatToolPayload.identifier,
      chatToolPayload.apiName,
      chatToolPayload.arguments ?? context.parsedArgs ?? {},
    );
    const pending = this.readOnlyInflight.get(key);
    if (pending) return { kind: 'follow', promise: pending };

    let resolve!: (v: ToolRunExecution) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<ToolRunExecution>((res, rej) => {
      reject = rej;
      resolve = res;
    });
    // Leader always rejects this on throw. Without a follower, that is otherwise unhandled.
    void promise.catch(() => {});
    this.readOnlyInflight.set(key, promise);
    return { kind: 'lead', key, reject, resolve };
  }

  private tryReadOnlyDedup(
    chatToolPayload: ChatToolPayload,
    context: ToolRunContext,
  ): ToolRunExecution['result'] | null {
    const hint = this.resolveCacheHint(chatToolPayload, context);
    if (!isToolCacheable(hint)) return null;

    const key = buildToolCacheKey(
      chatToolPayload.identifier,
      chatToolPayload.apiName,
      chatToolPayload.arguments ?? context.parsedArgs ?? {},
    );
    const cache = this.getToolResultCache(context);
    // lookupToolCache touches timestamp (true LRU)
    const hit = lookupToolCache(cache, key);
    if (!hit || !hit.success) return null;

    log(
      `[${this.ctx.operationId}:${this.ctx.stepIndex}] tool dedup hit %s:%s → %s`,
      chatToolPayload.identifier,
      chatToolPayload.apiName,
      hit.originalCallId,
    );

    return {
      content: buildDedupHitContent(hit),
      executionTime: 0,
      success: true,
    };
  }

  private rememberReadOnlyResult(
    chatToolPayload: ChatToolPayload,
    context: ToolRunContext,
    result: ToolRunExecution['result'],
  ) {
    if (!result.success) return;
    const hint = this.resolveCacheHint(chatToolPayload, context);
    if (!isToolCacheable(hint)) return;

    const key = buildToolCacheKey(
      chatToolPayload.identifier,
      chatToolPayload.apiName,
      chatToolPayload.arguments ?? context.parsedArgs ?? {},
    );
    // Persist only modelView — never raw MCP state (bloats Redis JSON).
    writeToolCache(this.getToolResultCache(context), key, {
      content: result.content,
      originalCallId: chatToolPayload.id,
      success: true,
      timestamp: Date.now(),
    });
  }
}
