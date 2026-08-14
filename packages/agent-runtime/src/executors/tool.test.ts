import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction, AgentState } from '../types';
import { callTool, callToolsBatch } from './tool';

const createCost = () => ({
  calculatedAt: '2026-07-09T00:00:00.000Z',
  currency: 'USD',
  llm: { byModel: [], currency: 'USD', total: 0 },
  tools: { byTool: [], currency: 'USD', total: 0 },
  total: 0,
});

const createUsage = () => ({
  humanInteraction: {
    approvalRequests: 0,
    promptRequests: 0,
    selectRequests: 0,
    totalWaitingTimeMs: 0,
  },
  llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
  tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
});

const createState = (overrides?: Partial<AgentState>): AgentState => ({
  cost: createCost(),
  createdAt: '2026-07-09T00:00:00.000Z',
  lastModified: '2026-07-09T00:00:00.000Z',
  maxSteps: 100,
  messages: [],
  metadata: {
    agentId: 'agent-1',
    threadId: 'thread-1',
    topicId: 'topic-1',
  },
  operationId: 'op-1',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: createUsage(),
  ...overrides,
});

const createToolCall = (id = 'tool-call-1', identifier = 'web-search') => ({
  apiName: 'search',
  arguments: '{"query":"test"}',
  id,
  identifier,
  type: 'default' as const,
});

describe('tool executors', () => {
  let createToolMessage: ReturnType<typeof vi.fn>;
  let publishChunk: ReturnType<typeof vi.fn>;
  let publishError: ReturnType<typeof vi.fn>;
  let publishEvent: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;
  let runTool: ReturnType<typeof vi.fn>;
  let host: AgentRuntimeHost;

  beforeEach(() => {
    createToolMessage = vi.fn().mockResolvedValue({ id: 'tool-msg-1' });
    publishChunk = vi.fn().mockResolvedValue(undefined);
    publishError = vi.fn().mockResolvedValue(undefined);
    publishEvent = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue([{ content: 'refreshed', id: 'msg-1', role: 'user' }]);
    runTool = vi.fn().mockResolvedValue({
      attempts: 1,
      result: {
        content: 'Tool result',
        executionTime: 100,
        state: {},
        success: true,
      },
    });

    host = {
      operation: {
        operationId: 'op-1',
        stepIndex: 2,
      },
      transports: {
        messages: {
          createAssistantMessage: vi.fn(),
          createToolMessage,
          deleteMessage: vi.fn(),
          findById: vi.fn(),
          query,
          update: vi.fn(),
          updatePluginState: vi.fn(),
          updateToolMessage: vi.fn(),
        },
        stream: {
          publishChunk,
          publishError,
          publishEvent,
        },
        tools: {
          getCost: vi.fn().mockReturnValue(0),
          handleError: vi.fn(),
          maxRetries: 2,
          run: runTool,
        },
      },
    } as unknown as AgentRuntimeHost;
  });

  it('executes a single tool, persists the result, and advances to tool_result', async () => {
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall(),
      },
      type: 'call_tool',
    };

    const result = await callTool(host)(instruction, createState());

    expect(runTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tool-call-1' }),
      expect.objectContaining({
        callIndex: 1,
        parentMessageId: 'assistant-msg-1',
        parsedArgs: { query: 'test' },
        toolName: 'web-search/search',
      }),
    );
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Tool result',
        metadata: { operationId: 'op-1', toolExecutionTimeMs: 100 },
        parentId: 'assistant-msg-1',
        role: 'tool',
        tool_call_id: 'tool-call-1',
      }),
    );
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_start' }));
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 1, isSuccess: true }),
        type: 'tool_end',
      }),
    );
    expect(result.nextContext?.phase).toBe('tool_result');
    expect(result.nextContext?.payload).toMatchObject({ parentMessageId: 'tool-msg-1' });
    expect(result.newState.usage.tools.totalCalls).toBe(1);
  });

  it('parks single client-source tools without invoking the transport runner', async () => {
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall('client-call', 'client-tool'),
      },
      type: 'call_tool',
    };

    const result = await callTool(host)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    expect(runTool).not.toHaveBeenCalled();
    expect(publishChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkType: 'tools_calling',
        toolsCalling: [expect.objectContaining({ id: 'client-call' })],
      }),
    );
    expect(result.newState.status).toBe('waiting_for_async_tool');
    expect(result.events).toContainEqual(
      expect.objectContaining({ reason: 'client_tool_execution', type: 'interrupted' }),
    );
  });

  it('executes server tools in a mixed batch then parks for client tools', async () => {
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [createToolCall('server-call'), createToolCall('client-call', 'client-tool')],
      },
      type: 'call_tools_batch',
    };

    const result = await callToolsBatch(host)(
      instruction,
      createState({ toolSourceMap: { 'client-tool': 'client' as any } }),
    );

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(createToolMessage).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      {
        agentId: 'agent-1',
        groupId: undefined,
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      { flatten: true, resolveAssetUrls: true },
    );
    expect(result.newState.status).toBe('waiting_for_async_tool');
    expect(result.newState.pendingToolsCalling).toEqual([
      expect.objectContaining({ id: 'client-call' }),
    ]);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'server-call', type: 'tool_result' }),
        expect.objectContaining({ reason: 'client_tool_execution', type: 'interrupted' }),
      ]),
    );
  });

  it('publishes each tool as it settles but returns results in model call order', async () => {
    type BatchExecution = {
      attempts: number;
      result: {
        content: string;
        executionTime: number;
        state: Record<string, unknown>;
        success: boolean;
      };
    };
    let resolveFirst: ((value: BatchExecution) => void) | undefined;
    let resolveSecond: ((value: BatchExecution) => void) | undefined;
    runTool.mockImplementation(
      (tool) =>
        new Promise((resolve) => {
          if (tool.id === 'first-call') resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );
    createToolMessage.mockImplementation(async (message) => ({
      id: `${message.tool_call_id}-message`,
    }));
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [createToolCall('first-call'), createToolCall('second-call')],
      },
      type: 'call_tools_batch',
    };

    const execution = callToolsBatch(host)(instruction, createState());
    await vi.waitFor(() => expect(runTool).toHaveBeenCalledTimes(2));

    resolveSecond?.({
      attempts: 1,
      result: { content: 'second', executionTime: 10, state: {}, success: true },
    });
    await vi.waitFor(() =>
      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payload: expect.objectContaining({
              toolCalling: expect.objectContaining({ id: 'second-call' }),
            }),
          }),
          type: 'tool_end',
        }),
      ),
    );
    expect(createToolMessage).toHaveBeenCalledTimes(1);
    expect(createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tool_call_id: 'second-call' }),
    );

    resolveFirst?.({
      attempts: 1,
      result: { content: 'first', executionTime: 20, state: {}, success: true },
    });
    const result = await execution;

    expect(createToolMessage.mock.calls.map(([message]) => message.tool_call_id)).toEqual([
      'second-call',
      'first-call',
    ]);
    expect(result.nextContext?.payload).toMatchObject({
      parentMessageId: 'second-call-message',
      toolResults: [
        expect.objectContaining({ toolCallId: 'first-call' }),
        expect.objectContaining({ toolCallId: 'second-call' }),
      ],
    });
  });

  it('reconciles already-visible tool messages after applying the round budget', async () => {
    runTool.mockResolvedValue({
      attempts: 1,
      result: {
        content: 'large result '.repeat(200),
        executionTime: 10,
        state: {},
        success: true,
      },
    });
    const instruction: Extract<AgentInstruction, { type: 'call_tools_batch' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolsCalling: [createToolCall('first-call'), createToolCall('second-call')],
      },
      type: 'call_tools_batch',
    };

    await callToolsBatch(host)(
      instruction,
      createState({
        metadata: {
          agentId: 'agent-1',
          contextPolicy: { budgets: { maxToolRoundTokens: 20 } },
          threadId: 'thread-1',
          topicId: 'topic-1',
        },
      }),
    );

    expect(host.transports.messages.updateToolMessage).toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_result_committed' }),
    );
  });

  it('publishes and rethrows tool-message persist errors', async () => {
    const error = new Error('database failed');
    createToolMessage.mockRejectedValueOnce(error);
    const instruction: Extract<AgentInstruction, { type: 'call_tool' }> = {
      payload: {
        parentMessageId: 'assistant-msg-1',
        toolCalling: createToolCall(),
      },
      type: 'call_tool',
    };

    await expect(callTool(host)(instruction, createState())).rejects.toThrow('database failed');
    expect(publishError).toHaveBeenCalledWith({
      error,
      phase: 'tool_message_persist',
      stepIndex: 2,
    });
  });
});
