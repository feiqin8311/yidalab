import type { ToolRunContext } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { ServerToolTransport } from './ServerToolTransport';

vi.mock('@lobechat/observability-otel/api', () => ({
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
}));

vi.mock('@lobechat/observability-otel/modules/agent-runtime', () => ({
  buildExecuteToolAttributes: () => ({}),
  buildExecuteToolResultAttributes: () => ({}),
  executeToolSpanName: (name: string) => name,
  tracer: {
    startSpan: () => ({
      end: vi.fn(),
      recordException: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
    }),
  },
}));

vi.mock('@/server/services/toolExecution/archiveToolResult', () => ({
  archiveToolResultIfNeeded: vi.fn(async ({ content }: { content: string }) => ({ content })),
}));

const sifPayload = (id: string): ChatToolPayload => ({
  apiName: 'ads_get_campaigns',
  arguments: '{"q":1}',
  id,
  identifier: 'company.mcp.sif-mcp',
  type: 'default' as ChatToolPayload['type'],
});

const makeContext = (
  executeTool: RuntimeExecutorContext['toolExecutionService']['executeTool'],
) => {
  const state = { messages: [], metadata: {} };
  const ctx = {
    operationId: 'op_sif_batch',
    serverDB: {},
    stepIndex: 0,
    streamManager: {},
    toolExecutionService: { executeTool },
    userId: 'user-1',
  } as unknown as RuntimeExecutorContext;

  const runContext: ToolRunContext = {
    callIndex: 0,
    effectiveManifestMap: {},
    mode: 'batch',
    operationId: 'op_sif_batch',
    parentMessageId: 'asst_1',
    parsedArgs: { q: 1 },
    state: state as ToolRunContext['state'],
    stepIndex: 0,
    toolName: 'company.mcp.sif-mcp/ads_get_campaigns',
  };

  return { ctx, runContext };
};

describe('ServerToolTransport read-only inflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes identical SIF queries in a Promise.all batch once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executeTool = vi.fn().mockImplementation(async () => {
      await gate;
      return { content: 'full-campaign-result', executionTime: 1, success: true };
    });

    const { ctx, runContext } = makeContext(executeTool);
    const transport = new ServerToolTransport(ctx);

    const pending = Array.from({ length: 11 }, (_, i) =>
      transport.run(sifPayload(`call_${i}`), runContext),
    );

    await vi.waitFor(() => {
      expect(executeTool).toHaveBeenCalled();
    });
    release();
    const results = await Promise.all(pending);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(11);
    expect(results.every((item) => item.result.success)).toBe(true);
    expect(results.every((item) => typeof item.result.content === 'string')).toBe(true);
  });

  it('does not coalesce non-cacheable writes', async () => {
    const executeTool = vi.fn().mockResolvedValue({
      content: 'written',
      executionTime: 1,
      success: true,
    });
    const { ctx, runContext } = makeContext(executeTool);
    const transport = new ServerToolTransport(ctx);
    const write = (id: string): ChatToolPayload => ({
      apiName: 'ads_update_campaign',
      arguments: '{"q":1}',
      id,
      identifier: 'company.mcp.sif-mcp',
      type: 'default' as ChatToolPayload['type'],
    });

    await Promise.all([
      transport.run(write('w1'), runContext),
      transport.run(write('w2'), runContext),
    ]);

    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it('does not emit unhandledRejection when a lone cacheable call throws', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const executeTool = vi.fn().mockRejectedValue(new Error('mcp down'));
      const { ctx, runContext } = makeContext(executeTool);
      const transport = new ServerToolTransport(ctx);

      await expect(transport.run(sifPayload('call_1'), runContext)).rejects.toThrow('mcp down');
      await new Promise((resolve) => setImmediate(resolve));

      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('propagates a failed leader to concurrent followers', async () => {
    const executeTool = vi.fn().mockRejectedValue(new Error('mcp down'));
    const { ctx, runContext } = makeContext(executeTool);
    const transport = new ServerToolTransport(ctx);

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) => transport.run(sifPayload(`call_${i}`), runContext)),
    );

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(results.every((item) => item.status === 'rejected')).toBe(true);
    expect(
      results.every(
        (item) => item.status === 'rejected' && (item.reason as Error).message === 'mcp down',
      ),
    ).toBe(true);
  });
});
