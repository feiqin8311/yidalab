import type { LobeChatDatabase } from '@lobechat/database';
import {
  buildLingxingAnalysis,
  LINGXING_ANALYZE_TOOL,
  LINGXING_MCP_IDENTIFIER,
  type LingxingAnalysisOutput,
} from '@lobechat/utils';
import { TRPCError } from '@trpc/server';

import { CompanyMarketMcpModel } from '@/database/models/companyMarketMcp';
import type { MCPClientParams } from '@/libs/mcp';
import { mcpService } from '@/server/services/mcp';

export type LingxingAnalyzeInput = {
  campaignName: string;
  country: string;
  sku: string;
  workspaceId: string;
};

const toClientParams = (
  identifier: string,
  connection: {
    auth?: { token?: string; type?: string };
    headers?: Record<string, string>;
    type?: string;
    url?: string;
  },
): MCPClientParams => {
  if (!connection?.url) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'LINGXING_MCP_CONNECTION_INVALID',
    });
  }

  const params: MCPClientParams = {
    name: identifier,
    type: 'http',
    url: connection.url,
  };

  if (connection.headers) {
    (params as { headers?: Record<string, string> }).headers = connection.headers;
  }

  if (connection.auth?.type && connection.auth.type !== 'none') {
    (params as { auth?: { token?: string; type: string } }).auth = {
      token: connection.auth.token,
      type: connection.auth.type,
    };
  }

  return params;
};

/**
 * Workspace-scoped lingxing analyze: only company.mcp.lingxing-mcp for this workspace.
 * No global/cross-workspace credential fallback.
 */
export class LingxingAdsService {
  constructor(private readonly db: LobeChatDatabase) {}

  analyze = async (input: LingxingAnalyzeInput): Promise<LingxingAnalysisOutput> => {
    const country = input.country.trim();
    const campaignName = input.campaignName.trim();
    const sku = input.sku.trim();

    if (!country || !campaignName || !sku) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'LINGXING_INPUT_REQUIRED' });
    }

    const model = new CompanyMarketMcpModel(this.db, input.workspaceId);
    const row = await model.findByIdentifier(LINGXING_MCP_IDENTIFIER);

    if (!row) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'LINGXING_MCP_NOT_CONFIGURED',
      });
    }

    const clientParams = toClientParams(row.identifier, row.connection || { type: 'http' });

    let toolResult: unknown;
    try {
      toolResult = await mcpService.callTool({
        argsStr: {
          campaign_name: campaignName,
          country,
          sku,
        },
        clientParams,
        toolName: LINGXING_ANALYZE_TOOL,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LINGXING_MCP_CALL_FAILED';
      throw new TRPCError({
        cause: error,
        code: 'BAD_GATEWAY',
        message: message.includes('LINGXING_') ? message : `LINGXING_MCP_CALL_FAILED: ${message}`,
      });
    }

    // MCP application error flag
    if (
      toolResult &&
      typeof toolResult === 'object' &&
      (toolResult as { state?: { isError?: boolean } }).state?.isError
    ) {
      const content =
        typeof (toolResult as { content?: unknown }).content === 'string'
          ? (toolResult as { content: string }).content
          : 'analyze_campaign failed';
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `LINGXING_ANALYZE_FAILED: ${content}`,
      });
    }

    try {
      return buildLingxingAnalysis(toolResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LINGXING_INVALID_PAYLOAD';
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message,
      });
    }
  };
}
