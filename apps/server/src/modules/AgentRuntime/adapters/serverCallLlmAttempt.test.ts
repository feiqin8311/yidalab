import type { AgentEvent, BlobStore } from '@lobechat/agent-runtime';
import { ToolNameResolver } from '@lobechat/context-engine';
import type { ChatMethodOptions, ModelRuntime } from '@lobechat/model-runtime';
import { ModelEmptyError } from '@lobechat/model-runtime';
import { RequestTrigger } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { createServerCallLlmAttempt } from './serverCallLlmAttempt';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

const consumeStreamUntilDone = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/model-runtime', async () => {
  const { isEmptyModelCompletion, ModelEmptyError } =
    await import('../../../../../../packages/model-runtime/src/errors/modelEmptyCompletion');
  const { consumeStreamUntilDone: realConsume, LLMStreamTimeoutError } =
    await import('../../../../../../packages/model-runtime/src/utils/consumeStream');
  consumeStreamUntilDone.mockImplementation(realConsume);

  return { consumeStreamUntilDone, isEmptyModelCompletion, LLMStreamTimeoutError, ModelEmptyError };
});

vi.mock('@/envs/file', () => ({
  fileEnv: { NEXT_PUBLIC_S3_FILE_PATH: 'files' },
}));

const toolName = new ToolNameResolver().generate('workspace', 'search', 'builtin');
const resolved = {
  enabledToolIds: ['workspace'],
  executorMap: { workspace: 'server' },
  manifestMap: {},
  promptManifestMap: {},
  sourceMap: { workspace: 'builtin' },
  tools: [
    {
      function: {
        description: 'Search the workspace',
        name: toolName,
        parameters: { type: 'object' },
      },
      type: 'function',
    },
  ],
} as ServerCallLlmTooling['resolved'];

const createAttempt = (
  runCallbacks: (options: ChatMethodOptions) => Promise<void>,
  blobStore?: BlobStore,
  trigger: unknown = 'user',
) => {
  const publishStreamChunk = vi.fn().mockResolvedValue('event-1');
  const streamManager = {
    publishStreamChunk,
    publishStreamEvent: vi.fn().mockResolvedValue('event-2'),
  } as unknown as RuntimeExecutorContext['streamManager'];
  const ctx = {
    messageModel: {} as RuntimeExecutorContext['messageModel'],
    operationId: 'operation-1',
    serverDB: {} as RuntimeExecutorContext['serverDB'],
    stepIndex: 2,
    streamManager,
    toolExecutionService: {} as RuntimeExecutorContext['toolExecutionService'],
    userId: 'user-1',
  } satisfies RuntimeExecutorContext;
  const chat = vi.fn(async (_payload, options?: ChatMethodOptions) => {
    await runCallbacks(options!);
    return new Response('done');
  });
  const events: AgentEvent[] = [];
  const onFirstChunk = vi.fn();
  const attempt = createServerCallLlmAttempt({
    attempt: 1,
    blobStore,
    chatPayload: {
      messages: [{ content: 'Question', role: 'user' }],
      model: 'test-model',
      stream: true,
      tools: resolved.tools,
    },
    ctx,
    events,
    maxAttempts: 3,
    messageCount: 1,
    model: 'test-model',
    modelRuntime: { chat } as unknown as Pick<ModelRuntime, 'chat'>,
    onFirstChunk,
    operationLogId: 'operation-1:2',
    provider: 'test-provider',
    resolved,
    topicId: 'topic-1',
    trigger,
  });

  return { attempt, chat, events, onFirstChunk, publishStreamChunk };
};

describe('ServerCallLlmAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collects callback output and exposes a completed attempt snapshot', async () => {
    const rawToolCall = {
      function: { arguments: '{"query":"docs"}', name: toolName },
      id: 'call-1',
      type: 'function' as const,
    };
    const { attempt, events, onFirstChunk, publishStreamChunk } = createAttempt(
      async ({ callback }) => {
        await callback?.onText?.('Visible answer');
        await callback?.onThinking?.('Reasoning');
        await callback?.onGrounding?.({ searchQueries: ['docs'] });
        await callback?.onToolsCalling?.({ chunk: [], toolsCalling: [rawToolCall] });
        await callback?.onCompletion?.({
          finishReason: 'tool_use',
          speed: { tps: 20, ttft: 100 },
          text: '',
          usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
        });
      },
    );

    await attempt.execute();

    const snapshot = attempt.snapshot();

    expect(snapshot.content).toBe('Visible answer');
    expect(snapshot.thinkingContent).toBe('Reasoning');
    expect(snapshot.grounding).toEqual({ searchQueries: ['docs'] });
    expect(snapshot.finishReason).toBe('tool_use');
    expect(snapshot.speed).toEqual({ tps: 20, ttft: 100 });
    expect(snapshot.usage).toEqual({
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalTokens: 15,
    });
    expect(snapshot.toolCalls).toEqual([rawToolCall]);
    expect(snapshot.toolsCalling).toEqual([
      expect.objectContaining({
        apiName: 'search',
        executor: 'server',
        id: 'call-1',
        identifier: 'workspace',
        source: 'builtin',
      }),
    ]);
    expect(onFirstChunk).toHaveBeenCalledTimes(5);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chunk: { text: 'Visible answer', type: 'text' } }),
        expect.objectContaining({ chunk: { text: 'Reasoning', type: 'reasoning' } }),
      ]),
    );
    expect(publishStreamChunk).toHaveBeenCalledWith(
      'operation-1',
      2,
      expect.objectContaining({ chunkType: 'tools_calling' }),
    );
  });

  it('keeps partial output and usage readable after a stream error', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onText?.('Partial answer');
      await callback?.onCompletion?.({
        text: '',
        usage: { totalOutputTokens: 3 },
      });
      await callback?.onError?.({
        errorType: 'ProviderBizError',
        message: 'provider stream failed',
        status: 503,
      });
    });

    await expect(attempt.execute()).rejects.toMatchObject({
      errorType: 'ProviderBizError',
      message: 'LLM stream error: provider stream failed',
      status: 503,
    });
    attempt.clearBuffers();

    expect(attempt.snapshot()).toEqual(
      expect.objectContaining({
        content: 'Partial answer',
        usage: { totalOutputTokens: 3 },
      }),
    );
  });

  it('times out modelRuntime.chat() before the stream is open', async () => {
    vi.useFakeTimers();
    const { attempt, chat } = createAttempt(async () => {
      await new Promise(() => {});
    });

    const pending = attempt.execute();
    const expectation = expect(pending).rejects.toMatchObject({
      kind: 'first_chunk',
      message: 'LLM_FIRST_CHUNK_TIMEOUT: no first byte after 90000ms',
      name: 'LLMStreamTimeoutError',
    });
    await vi.advanceTimersByTimeAsync(90_000);
    await expectation;
    expect(chat).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('allows bot operations more time to receive the first model chunk', async () => {
    vi.useFakeTimers();
    const { attempt, chat } = createAttempt(
      async () => {
        await new Promise(() => {});
      },
      undefined,
      RequestTrigger.Bot,
    );

    let settled = false;
    const pending = attempt.execute().catch((error: unknown) => {
      settled = true;
      throw error;
    });
    const expectation = expect(pending).rejects.toMatchObject({
      kind: 'first_chunk',
      message: 'LLM_FIRST_CHUNK_TIMEOUT: no first byte after 150000ms',
      name: 'LLMStreamTimeoutError',
    });

    await vi.advanceTimersByTimeAsync(90_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    await expectation;
    expect(chat).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('gives consumeStreamUntilDone only the leftover first-byte budget', async () => {
    vi.useFakeTimers();
    const { attempt } = createAttempt(async ({ callback }) => {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      await callback?.onText?.('Visible answer');
    });

    const pending = attempt.execute();
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    expect(consumeStreamUntilDone).toHaveBeenCalledWith(
      expect.any(Response),
      expect.objectContaining({ firstChunkTimeoutMs: expect.any(Number) }),
    );
    const options = consumeStreamUntilDone.mock.calls.at(-1)?.[1] as {
      firstChunkTimeoutMs?: number;
    };
    expect(options.firstChunkTimeoutMs).toBeGreaterThan(0);
    expect(options.firstChunkTimeoutMs).toBeLessThanOrEqual(30_000);
    vi.useRealTimers();
  });

  it('salvages a natural-stop answer emitted only in reasoning', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onThinking?.('Final answer from reasoning');
      await callback?.onCompletion?.({
        finishReason: 'stop',
        text: '',
        usage: { totalOutputTokens: 5 },
      });
    });

    await attempt.execute();

    expect(attempt.snapshot()).toEqual(
      expect.objectContaining({
        answerSalvagedFromReasoning: true,
        content: 'Final answer from reasoning',
        thinkingContent: '',
      }),
    );
  });

  it('rejects hidden reasoning when the model produces no user-visible reply', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onThinking?.('Internal reasoning without a final answer');
      await callback?.onCompletion?.({
        text: '',
        usage: { totalOutputTokens: 38 },
      });
    });

    await expect(attempt.execute()).rejects.toBeInstanceOf(ModelEmptyError);
    expect(attempt.snapshot()).toEqual(
      expect.objectContaining({
        content: '',
        thinkingContent: 'Internal reasoning without a final answer',
      }),
    );
  });

  it('persists generated images through BlobStore and snapshots the resolved URL', async () => {
    const blobStore: BlobStore = {
      persistBase64: vi.fn().mockResolvedValue({
        fileId: 'file-1',
        key: 'files/generations/image.png',
        url: 'https://files.example/image.png',
      }),
      resolveUrl: vi.fn(),
    };
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onContentPart?.({ content: 'Generated image:', partType: 'text' });
      await callback?.onContentPart?.({
        content: 'BASE64_IMAGE',
        mimeType: 'image/png',
        partType: 'image',
      });
      await callback?.onCompletion?.({
        text: '',
        usage: { totalOutputTokens: 1 },
      });
    }, blobStore);

    await attempt.execute();

    expect(blobStore.persistBase64).toHaveBeenCalledWith(
      'BASE64_IMAGE',
      expect.stringMatching(/files\/generations\/.+\.png$/),
    );
    expect(attempt.snapshot()).toEqual(
      expect.objectContaining({
        contentParts: [
          { text: 'Generated image:', type: 'text' },
          { image: 'https://files.example/image.png', type: 'image' },
        ],
        hasContentImages: true,
      }),
    );
  });
});
