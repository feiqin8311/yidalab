import type { AgentEvent, BlobStore, LLMAttemptOutput } from '@lobechat/agent-runtime';
import { ToolNameResolver } from '@lobechat/context-engine';
import type { ChatStreamPayload, ModelRuntime } from '@lobechat/model-runtime';
import {
  consumeStreamUntilDone,
  isEmptyModelCompletion,
  LLMStreamTimeoutError,
  ModelEmptyError,
} from '@lobechat/model-runtime';
import type {
  ChatImageItem,
  ChatToolPayload,
  GroundingSearch,
  MessageToolCall,
  ModelPerformance,
  ModelUsage,
} from '@lobechat/types';
import { pickString, toRecord } from '@lobechat/utils/object';

import type { RuntimeExecutorContext } from '../context';
import {
  isOperationInterrupted,
  LLM_STREAM_IDLE_TIMEOUT_MS,
  LLM_TURN_TOTAL_TIMEOUT_MS,
  log,
  remainingDeadlineMs,
  resolveLLMFirstChunkTimeoutMs,
  timing,
  watchAndAbortWhenTerminal,
  withDeadline,
} from '../executorHelpers';
import { previewToolsCallingForStream } from './previewToolsCallingForStream';
import {
  createServerCallLlmStreamSink,
  type ServerCallLlmStreamSink,
} from './serverCallLlmStreamSink';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

interface CreateServerCallLlmAttemptInput {
  attempt: number;
  blobStore?: BlobStore;
  chatPayload: ChatStreamPayload;
  ctx: RuntimeExecutorContext;
  events: AgentEvent[];
  maxAttempts: number;
  messageCount: number;
  model: string;
  modelRuntime: Pick<ModelRuntime, 'chat'>;
  onFirstChunk: () => void;
  operationLogId: string;
  provider: string;
  resolved: ServerCallLlmTooling['resolved'];
  topicId?: string;
  trigger?: unknown;
}

const createStreamExecutionError = (errorData: unknown) => {
  const errorRecord = toRecord(errorData);
  const message = pickString(errorRecord?.message);
  const error = new Error(
    message ? `LLM stream error: ${message}` : `LLM stream error: ${JSON.stringify(errorData)}`,
  );

  if (errorRecord) {
    const { message: _message, ...details } = errorRecord;
    Object.assign(error, details);
  }

  return error;
};

export class ServerCallLlmAttempt {
  private answerSalvagedFromReasoning = false;
  private readonly attempt: number;
  private readonly chatPayload: ChatStreamPayload;
  private readonly ctx: RuntimeExecutorContext;
  private finishReason?: string;
  private grounding: GroundingSearch | null = null;
  private readonly imageList: ChatImageItem[] = [];
  private readonly maxAttempts: number;
  private readonly messageCount: number;
  private readonly model: string;
  private readonly modelRuntime: Pick<ModelRuntime, 'chat'>;
  private readonly onFirstChunk: () => void;
  private readonly operationLogId: string;
  private readonly provider: string;
  private readonly resolved: ServerCallLlmTooling['resolved'];
  private speed?: ModelPerformance;
  private readonly streamSink: ServerCallLlmStreamSink;
  private streamError?: unknown;
  private toolCalls: MessageToolCall[] = [];
  private toolsCalling: ChatToolPayload[] = [];
  private readonly topicId?: string;
  private readonly trigger?: unknown;
  private usage?: ModelUsage;

  constructor({
    attempt,
    blobStore,
    chatPayload,
    ctx,
    events,
    maxAttempts,
    messageCount,
    model,
    modelRuntime,
    onFirstChunk,
    operationLogId,
    provider,
    resolved,
    topicId,
    trigger,
  }: CreateServerCallLlmAttemptInput) {
    this.attempt = attempt;
    this.chatPayload = chatPayload;
    this.ctx = ctx;
    this.maxAttempts = maxAttempts;
    this.messageCount = messageCount;
    this.model = model;
    this.modelRuntime = modelRuntime;
    this.onFirstChunk = onFirstChunk;
    this.operationLogId = operationLogId;
    this.provider = provider;
    this.resolved = resolved;
    this.streamSink = createServerCallLlmStreamSink({
      blobStore,
      ctx,
      events,
      operationLogId,
    });
    this.topicId = topicId;
    this.trigger = trigger;
  }

  async execute(): Promise<void> {
    log(
      '[%s][call_llm] calling model-runtime chat (attempt %d/%d, model: %s, messages: %d, tools: %d)',
      this.operationLogId,
      this.attempt,
      this.maxAttempts,
      this.model,
      this.messageCount,
      this.chatPayload.tools?.length ?? 0,
    );

    const abort = new AbortController();
    const stopWatch = watchAndAbortWhenTerminal(this.ctx, abort);
    const firstChunkTimeoutMs = resolveLLMFirstChunkTimeoutMs(this.trigger);
    const firstByteDeadlineAt = Date.now() + firstChunkTimeoutMs;
    const turnDeadlineAt = Date.now() + LLM_TURN_TOTAL_TIMEOUT_MS;
    const firstByteTimeout = () => {
      abort.abort();
      return new LLMStreamTimeoutError('first_chunk', firstChunkTimeoutMs);
    };
    const heartbeat = () => {
      this.onFirstChunk();
    };

    try {
      const response = await withDeadline(
        this.modelRuntime.chat(this.chatPayload, {
          callback: {
            onBase64Image: async ({ image }) => {
              heartbeat();
              await this.streamSink.appendBase64Image(image);
            },
            onCompletion: async (data) => {
              heartbeat();
              if (data.usage) this.usage = data.usage;
              if (data.speed) this.speed = data.speed;
              if (data.finishReason) this.finishReason = data.finishReason;
            },
            onContentPart: async (part) => {
              heartbeat();
              await this.streamSink.appendContentPart(part);
            },
            onError: async (errorData) => {
              this.streamError = errorData;
              console.error(`[${this.operationLogId}][stream_error]`, errorData);
            },
            onGrounding: async (groundingData) => {
              heartbeat();
              log(`[${this.operationLogId}][grounding] %O`, groundingData);
              this.grounding = groundingData;

              await this.ctx.streamManager.publishStreamChunk(
                this.ctx.operationId,
                this.ctx.stepIndex,
                {
                  chunkType: 'grounding',
                  grounding: groundingData,
                },
              );
            },
            onReasoningPart: async (part) => {
              heartbeat();
              await this.streamSink.appendReasoningPart(part);
            },
            onText: async (text) => {
              heartbeat();
              timing(
                '[%s] onText received chunk at %d, length: %d',
                this.operationLogId,
                Date.now(),
                text.length,
              );
              await this.streamSink.appendText(text);
            },
            onThinking: async (reasoning) => {
              heartbeat();
              timing(
                '[%s] onThinking received chunk at %d, length: %d',
                this.operationLogId,
                Date.now(),
                reasoning.length,
              );
              await this.streamSink.appendThinking(reasoning);
            },
            onToolsCalling: async ({ toolsCalling: raw }) => {
              heartbeat();
              const resolvedCalls = new ToolNameResolver().resolve(
                raw,
                this.resolved.promptManifestMap,
                this.resolved.tools.map((tool) => tool.function.name),
              );
              const payload = resolvedCalls.map((toolCall) => ({
                ...toolCall,
                executor: this.resolved.executorMap?.[toolCall.identifier],
                source: this.resolved.sourceMap[toolCall.identifier],
              }));

              this.toolsCalling = payload;
              // Keep raw arguments through execution so malformed JSON can reach the
              // tool error path and give the model a self-repair signal. Finalizers
              // sanitize only the persisted DB and replay-state copies.
              this.toolCalls = raw;

              await this.streamSink.flushTextBuffer();
              await this.ctx.streamManager.publishStreamChunk(
                this.ctx.operationId,
                this.ctx.stepIndex,
                {
                  chunkType: 'tools_calling',
                  // Full HTML/JSON stays on `this.toolsCalling` for execution.
                  toolsCalling: previewToolsCallingForStream(payload),
                },
              );
            },
          },
          metadata: {
            operationId: this.ctx.operationId,
            topicId: this.topicId,
            trigger: this.trigger,
          },
          signal: abort.signal,
          user: this.ctx.userId,
        }),
        remainingDeadlineMs(firstByteDeadlineAt),
        firstByteTimeout,
      );

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
    } finally {
      stopWatch();
    }

    if (this.streamError) throw createStreamExecutionError(this.streamError);

    await this.streamSink.flushTextBuffer();
    await this.streamSink.flushReasoningBuffer();
    this.streamSink.clearBuffers();
    await this.streamSink.waitForImageUploads();

    this.salvageAnswerFromReasoning();
    await this.assertNonEmptyCompletion();
    this.logResult();
  }

  clearBuffers() {
    this.streamSink.clearBuffers();
  }

  snapshot(): LLMAttemptOutput {
    return {
      answerSalvagedFromReasoning: this.answerSalvagedFromReasoning,
      content: this.streamSink.content,
      contentParts: [...this.streamSink.contentParts],
      finishReason: this.finishReason,
      grounding: this.grounding,
      hasContentImages: this.streamSink.hasContentImages,
      hasReasoningImages: this.streamSink.hasReasoningImages,
      imageList: [...this.imageList],
      reasoningParts: [...this.streamSink.reasoningParts],
      speed: this.speed,
      thinkingContent: this.streamSink.thinkingContent,
      toolCalls: [...this.toolCalls],
      toolsCalling: [...this.toolsCalling],
      usage: this.usage,
    };
  }

  private async assertNonEmptyCompletion() {
    if (
      isEmptyModelCompletion({
        content: this.streamSink.content,
        imageCount: this.imageList.length,
        outputTokens: this.usage?.totalOutputTokens,
        reasoning: this.streamSink.thinkingContent,
        toolCallCount: this.toolsCalling.length + this.toolCalls.length,
      }) &&
      !(await isOperationInterrupted(this.ctx))
    ) {
      log(
        '[%s] Model returned an empty completion (attempt %d/%d) — throwing ModelEmptyError to retry',
        this.operationLogId,
        this.attempt,
        this.maxAttempts,
      );
      throw new ModelEmptyError(undefined, {
        attempt: this.attempt,
        contentLength: this.streamSink.content.length,
        finishReason: this.finishReason,
        imageCount: this.imageList.length,
        maxAttempts: this.maxAttempts,
        model: this.model,
        outputTokens: this.usage?.totalOutputTokens,
        provider: this.provider,
        reasoningLength: this.streamSink.thinkingContent.length,
        toolCallCount: this.toolsCalling.length + this.toolCalls.length,
      });
    }
  }

  private logResult() {
    log(
      '[%s] finish model-runtime calling | content: %d chars | reasoning: %d chars | tools: %d | usage: %s',
      this.operationLogId,
      this.streamSink.content.length,
      this.streamSink.thinkingContent.length,
      this.toolsCalling.length,
      this.usage ? 'yes' : 'none',
    );

    if (this.streamSink.thinkingContent) {
      log(`[${this.operationLogId}][reasoning]`, this.streamSink.thinkingContent);
    }
    if (this.streamSink.content) {
      log(`[${this.operationLogId}][content]`, this.streamSink.content);
    }
    if (this.toolsCalling.length > 0) {
      log(`[${this.operationLogId}][toolsCalling] `, this.toolsCalling);
    }
    if (this.usage) {
      log(`[${this.operationLogId}][usage] %O`, this.usage);
    }
  }

  private salvageAnswerFromReasoning() {
    const isTerminalNaturalStop = this.finishReason === 'end_turn' || this.finishReason === 'stop';
    if (
      isTerminalNaturalStop &&
      this.toolsCalling.length === 0 &&
      this.toolCalls.length === 0 &&
      this.streamSink.content.trim().length === 0 &&
      this.streamSink.thinkingContent.trim().length > 0 &&
      !this.streamSink.hasReasoningImages
    ) {
      log(
        '[%s] answer-in-thinking salvage: promoting %d chars of reasoning to content',
        this.operationLogId,
        this.streamSink.thinkingContent.length,
      );
      this.streamSink.content = this.streamSink.thinkingContent;
      this.streamSink.thinkingContent = '';
      this.answerSalvagedFromReasoning = true;
    }
  }
}

export const createServerCallLlmAttempt = (input: CreateServerCallLlmAttemptInput) =>
  new ServerCallLlmAttempt(input);
