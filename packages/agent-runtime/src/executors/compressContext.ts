import type { CompressionSnapshotV2 } from '@lobechat/types';

import { UsageCounter } from '../core';
import type { AgentRuntimeHost } from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AnyHookEvent,
  GeneralAgentCompressionResultPayload,
  InstructionExecutor,
} from '../types';
import { COMPRESSION_FAILURE_CEILING_RATIO, DEFAULT_MAX_CONTEXT } from '../utils/tokenCounter';

const requireCompressionTransport = (host: AgentRuntimeHost) => {
  const compression = host.transports.compression;
  if (!compression) {
    throw new Error('CompressionTransport is required for compress_context executor');
  }
  return compression;
};

const requireLLMTransport = (host: AgentRuntimeHost) => {
  const llm = host.transports.llm;
  if (!llm) {
    throw new Error('LLMTransport is required for compress_context executor');
  }
  return llm;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(error);
};

const dispatchLifecycle = (
  host: AgentRuntimeHost,
  type: Parameters<NonNullable<AgentRuntimeHost['lifecycle']>['dispatch']>[0]['type'],
  event: AnyHookEvent,
  serializedHooks: unknown,
) => {
  host.lifecycle
    ?.dispatch({
      event,
      serializedHooks,
      type,
    })
    .catch(() => {});
};

/**
 * `compress_context` executor — creates a compressed message group, asks the
 * configured compression model to summarize it, and returns a
 * `compression_result` phase that the agent can continue from.
 *
 * Strict V2: model output is parsed via transport.parseOutput (throws on
 * invalid schema). One retry on parse failure. finalizeGroup only receives
 * already-validated content + snapshot.
 *
 * On failure: cancel placeholder group. Below 85% adjusted fill, reuseOnce;
 * above, fail closed with context_compression_failed.
 */
export const compressContext =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'compress_context' }>;
    const {
      messages,
      currentTokenCount,
      adjustedTokenCount,
      existingSummary,
      existingSnapshot,
      legacySummary,
      sourceGroupIds,
      maxSummaryTokens,
      maxWindowToken,
    } = payload;
    const { operation, transports } = host;
    const { operationId, stepIndex, userId } = operation;
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const topicId = state.metadata?.topicId ?? operation.topicId;
    const workspaceId = state.metadata?.workspaceId ?? operation.workspaceId;
    const lastMessage = messages.at(-1);
    const preservedMessages =
      messages.length > 1 && lastMessage?.role === 'user' ? [lastMessage] : [];
    const preservedMessageIds = new Set(
      preservedMessages.map((message) => message.id).filter((id): id is string => Boolean(id)),
    );
    const messagesToCompress = preservedMessages.length > 0 ? messages.slice(0, -1) : messages;
    const compressedMessagesFallback = [...messagesToCompress, ...preservedMessages];
    const windowTokens =
      maxWindowToken && maxWindowToken > 0 ? maxWindowToken : DEFAULT_MAX_CONTEXT;
    const failureCeiling = Math.floor(windowTokens * COMPRESSION_FAILURE_CEILING_RATIO);
    // Prefer adjusted (drift) count for the ceiling — raw underestimates real fill
    const fillForCeiling = adjustedTokenCount ?? currentTokenCount;

    const createNextContext = (result: GeneralAgentCompressionResultPayload) => ({
      payload: result,
      phase: 'compression_result' as const,
      session: {
        messageCount: newState.messages.length,
        sessionId: operationId,
        status: 'running' as const,
        stepCount: state.stepCount + 1,
      },
    });

    const skippedResult = (
      parentMessageId?: string,
      extra?: Partial<GeneralAgentCompressionResultPayload>,
    ) => ({
      events,
      newState,
      nextContext: createNextContext({
        compressedMessages: compressedMessagesFallback,
        groupId: '',
        parentMessageId,
        skipped: true,
        ...extra,
      }),
    });

    const failClosedResult = (error: unknown, parentMessageId?: string) => {
      const errorMessage = getErrorMessage(error);
      events.push({ error, type: 'compression_error' });
      return {
        events,
        newState,
        nextContext: createNextContext({
          compressedMessages: compressedMessagesFallback,
          errorCode: 'context_compression_failed',
          errorMessage,
          failed: true,
          groupId: '',
          parentMessageId,
          skipped: true,
        }),
      };
    };

    const reuseOnceResult = (error: unknown, parentMessageId?: string) => {
      events.push({ error, type: 'compression_error' });
      return {
        events,
        newState,
        nextContext: createNextContext({
          compressedMessages: compressedMessagesFallback,
          groupId: '',
          parentMessageId,
          reuseOnce: true,
          skipped: true,
        }),
      };
    };

    if (!topicId || !userId) {
      return skippedResult();
    }

    dispatchLifecycle(
      host,
      'beforeCompact',
      {
        messageCount: messagesToCompress.length,
        operationId,
        stepIndex,
        tokenCount: currentTokenCount,
        userId,
      } as AnyHookEvent,
      state.metadata?._hooks,
    );

    let createdGroupId: string | undefined;
    let latestAssistantId: string | undefined;

    const cancelPlaceholder = async () => {
      if (!createdGroupId || !topicId) return;
      try {
        const compression = host.transports.compression;
        if (!compression?.cancelGroup) return;
        await compression.cancelGroup({
          agentId: state.metadata?.agentId,
          groupId: state.metadata?.groupId,
          messageGroupId: createdGroupId,
          threadId: state.metadata?.threadId,
          topicId,
          workspaceId,
        });
      } catch {
        // best-effort cleanup
      }
    };

    const onFailure = async (error: unknown) => {
      await cancelPlaceholder();

      dispatchLifecycle(
        host,
        'onCompactError',
        {
          error: getErrorMessage(error),
          operationId,
          stepIndex,
          tokenCount: currentTokenCount,
          userId,
        } as AnyHookEvent,
        state.metadata?._hooks,
      );

      if (fillForCeiling > failureCeiling) {
        return failClosedResult(error, latestAssistantId);
      }
      return reuseOnceResult(error, latestAssistantId);
    };

    try {
      const compression = requireCompressionTransport(host);
      const llm = requireLLMTransport(host);

      const dbMessages = await transports.messages.query(
        {
          agentId: state.metadata?.agentId,
          groupId: state.metadata?.groupId,
          threadId: state.metadata?.threadId,
          topicId,
        },
        { resolveAssetUrls: true },
      );

      const messageIds = dbMessages
        .filter(
          (message) =>
            message.role !== 'compressedGroup' &&
            Boolean(message.id) &&
            !preservedMessageIds.has(message.id),
        )
        .map((message) => message.id);

      const priorGroupIds =
        sourceGroupIds && sourceGroupIds.length > 0
          ? sourceGroupIds
          : dbMessages.filter((m) => m.role === 'compressedGroup' && m.id).map((m) => m.id);

      // Only current-batch USER messages may authorize new/supersede constraints
      const currentUserMessageIds = compressionResultUserIds(
        compressionResultMessages(dbMessages, messageIds),
      );

      if (messageIds.length === 0 || messagesToCompress.length === 0) {
        return skippedResult();
      }

      const latestAssistantMessage = dbMessages.findLast((message) => message.role === 'assistant');
      latestAssistantId = latestAssistantMessage?.id;

      const compressionResult = await compression.createGroup({
        agentId: state.metadata?.agentId,
        groupId: state.metadata?.groupId,
        messageIds,
        threadId: state.metadata?.threadId,
        topicId,
        workspaceId,
      });
      createdGroupId = compressionResult.messageGroupId;

      // Prefer user ids from messages actually sent to the model
      const userIdsFromSummarize = compressionResult.messagesToSummarize
        .filter((m) => m.role === 'user' && m.id)
        .map((m) => m.id);
      const strictUserIds =
        userIdsFromSummarize.length > 0 ? userIdsFromSummarize : currentUserMessageIds;

      const compressionModel =
        newState.modelRuntimeConfig?.compressionModel || newState.modelRuntimeConfig;

      if (!compressionModel?.model || !compressionModel?.provider) {
        return await onFailure(new Error('compression_model_missing'));
      }

      const resolvedLegacy =
        legacySummary ?? (existingSnapshot ? undefined : existingSummary) ?? undefined;

      const compressionPayload = await compression.buildPrompt({
        existingSnapshot: (existingSnapshot ?? null) as CompressionSnapshotV2 | null,
        existingSummary: resolvedLegacy,
        legacySummary: resolvedLegacy,
        maxSummaryTokens,
        messages: compressionResult.messagesToSummarize,
        sourceGroupIds: priorGroupIds,
      });

      let rawContent = '';
      let parseRetries = 0;
      let parsed:
        | {
            content: string;
            metadata: Record<string, unknown>;
            snapshot: CompressionSnapshotV2;
          }
        | undefined;
      let lastError: unknown;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const summaryResult = await llm.stream({
            messages:
              attempt === 0
                ? compressionPayload.messages
                : [
                    ...compressionPayload.messages,
                    {
                      content: rawContent
                        ? `Previous output was invalid CompressionSnapshotV2 JSON. Fix and return ONLY a valid object.\n\nPrevious output:\n${rawContent.slice(0, 4000)}`
                        : 'Previous output was empty or invalid. Return ONLY a valid CompressionSnapshotV2 JSON object.',
                      role: 'user' as const,
                    },
                  ],
            model: compressionModel.model,
            provider: compressionModel.provider,
            stream: true,
          });

          rawContent = summaryResult.content ?? '';
          if (!rawContent.trim()) {
            throw new Error('empty_compression_output');
          }

          // Strict V2 — throws on invalid schema (no free-form markdown accept)
          const userMessages = compressionResult.messagesToSummarize
            .filter((m) => m.role === 'user' && m.id)
            .map((m) => ({
              content: typeof m.content === 'string' ? m.content : '',
              id: m.id,
            }));
          const parseResult = await compression.parseOutput({
            currentUserMessageIds: strictUserIds,
            existingSnapshot: (existingSnapshot ?? null) as CompressionSnapshotV2 | null,
            maxSummaryTokens,
            raw: rawContent,
            sourceGroupIds: priorGroupIds,
            userMessages,
          });

          parsed = {
            content: parseResult.content,
            metadata: parseResult.metadata as Record<string, unknown>,
            snapshot: parseResult.snapshot,
          };

          if (summaryResult.usage) {
            const { usage, cost } = UsageCounter.accumulateLLM({
              cost: newState.cost,
              model: compressionModel.model,
              modelUsage: summaryResult.usage,
              provider: compressionModel.provider,
              usage: newState.usage,
            });

            newState.usage = usage;
            if (cost) newState.cost = cost;
          }

          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          parseRetries = attempt + 1;
          if (attempt === 0) continue;
        }
      }

      if (lastError || !parsed) {
        return await onFailure(lastError ?? new Error('compression_parse_failed'));
      }

      const finalCompression = await compression.finalizeGroup({
        agentId: state.metadata?.agentId,
        content: parsed.content,
        groupId: state.metadata?.groupId,
        messageGroupId: compressionResult.messageGroupId,
        messageIds,
        mergeGroupIds: priorGroupIds.filter((id) => id !== compressionResult.messageGroupId),
        metadata: {
          originalMessageCount: messageIds.length,
          originalTokenCount: currentTokenCount,
          parseRetries,
          tokensBefore: currentTokenCount,
          ...parsed.metadata,
        },
        snapshot: parsed.snapshot,
        threadId: state.metadata?.threadId,
        topicId,
        workspaceId,
      });

      createdGroupId = undefined;

      const compressedMessagesBase =
        finalCompression.messages || compressionResult.messagesToSummarize;
      const compressedMessages = [...compressedMessagesBase];

      for (const preservedMessage of preservedMessages) {
        if (
          !compressedMessages.some(
            (message) =>
              message === preservedMessage ||
              (Boolean(message.id) &&
                Boolean(preservedMessage.id) &&
                message.id === preservedMessage.id),
          )
        ) {
          compressedMessages.push(preservedMessage);
        }
      }

      newState.messages = compressedMessages;

      events.push({
        groupId: compressionResult.messageGroupId,
        parentMessageId: latestAssistantMessage?.id,
        type: 'compression_complete',
      });

      dispatchLifecycle(
        host,
        'afterCompact',
        {
          activeHardConstraintCount: (parsed.metadata as any).activeHardConstraintCount,
          groupId: compressionResult.messageGroupId,
          mergedGroupCount: priorGroupIds.length,
          messagesAfter: compressedMessages.length,
          messagesBefore: messagesToCompress.length,
          newConstraintCount: (parsed.metadata as any).newConstraintCount,
          operationId,
          parseRetries,
          snapshotVersion: 2,
          stepIndex,
          summary: parsed.content.slice(0, 500),
          supersededConstraintCount: (parsed.metadata as any).supersededConstraintCount,
          userId,
        } as AnyHookEvent,
        state.metadata?._hooks,
      );

      return {
        events,
        newState,
        nextContext: {
          ...createNextContext({
            compressedMessages,
            groupId: compressionResult.messageGroupId,
            parentMessageId: latestAssistantMessage?.id,
          }),
          session: {
            messageCount: compressedMessages.length,
            sessionId: operationId,
            status: 'running' as const,
            stepCount: state.stepCount + 1,
          },
        },
      };
    } catch (error) {
      return await onFailure(error);
    }
  };

const compressionResultMessages = (
  dbMessages: Array<{ id: string; role: string }>,
  messageIds: string[],
) => {
  const idSet = new Set(messageIds);
  return dbMessages.filter((m) => idSet.has(m.id));
};

const compressionResultUserIds = (msgs: Array<{ id: string; role: string }>) =>
  msgs.filter((m) => m.role === 'user' && m.id).map((m) => m.id);
