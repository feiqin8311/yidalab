// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ToolExecutionService } from '../index';

describe('ToolExecutionService', () => {
  it('can skip low-level result truncation for AgentRuntime archival', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        skipResultTruncation: true,
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toBe('0123456789');
  });

  it('keeps existing low-level truncation by default', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toContain('01234');
    expect(result.content).toContain('Content truncated');
  });

  it('treats an MCP envelope with state.isError as a failed execution', async () => {
    const mcpService = {
      callTool: vi.fn().mockResolvedValue({
        content: '{"error":"remote query failed"}',
        state: {
          content: [{ text: 'remote query failed', type: 'text' }],
          isError: true,
        },
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: {} as any,
      mcpService: mcpService as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'query',
        arguments: '{}',
        id: 'tool-call-mcp-error',
        identifier: 'broken-mcp',
        type: 'mcp',
      },
      {
        toolManifestMap: {
          'broken-mcp': { mcpParams: { type: 'http', url: 'https://mcp.example' } },
        } as any,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toEqual(expect.objectContaining({ message: expect.any(String) }));
  });

  it('treats a raw MCP CallToolResult with isError as a failed execution', async () => {
    const service = new ToolExecutionService({
      builtinToolsExecutor: {} as any,
      mcpService: {
        callTool: vi.fn().mockResolvedValue({
          content: [{ text: 'rate limited', type: 'text' }],
          isError: true,
        }),
      } as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'query',
        arguments: '{}',
        id: 'tool-call-raw-mcp-error',
        identifier: 'broken-mcp',
        type: 'mcp',
      },
      {
        toolManifestMap: {
          'broken-mcp': { mcpParams: { type: 'http', url: 'https://mcp.example' } },
        } as any,
      },
    );

    expect(result.success).toBe(false);
  });
});
