import type { LobeChatDatabase } from '@lobechat/database';
import {
  buildLingxingAnalysis,
  buildV7Markdown,
  LINGXING_ANALYZE_TOOL,
  LINGXING_MCP_IDENTIFIER,
  type LingxingAnalysisOutput,
} from '@lobechat/utils';
import { TRPCError } from '@trpc/server';

import { CompanyMarketMcpModel } from '@/database/models/companyMarketMcp';
import type { MCPClientParams } from '@/libs/mcp';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { mcpService } from '@/server/services/mcp';

export type LingxingAnalyzeInput = {
  campaignName: string;
  country: string;
  model: { model: string; provider: string };
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

const CONCLUSION_SCHEMA = {
  description: 'Refined lingxing ads conclusion',
  name: 'lingxing_conclusion',
  schema: {
    additionalProperties: false,
    properties: {
      detail: {
        description: '2-4 Chinese sentences: trend judgment + main drivers + next actions',
        type: 'string',
      },
    },
    required: ['detail'],
    type: 'object',
  },
} as const;

/**
 * Workspace-scoped lingxing analyze: only company.mcp.lingxing-mcp for this workspace.
 * MCP pulls metrics; fixed V7 rules structure the report; optional model polishes §1 conclusion.
 */
export class LingxingAdsService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  analyze = async (input: LingxingAnalyzeInput): Promise<LingxingAnalysisOutput> => {
    const country = input.country.trim();
    const campaignName = input.campaignName.trim();
    const sku = input.sku.trim();
    const provider = input.model.provider.trim();
    const modelId = input.model.model.trim();

    if (!country || !campaignName || !sku) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'LINGXING_INPUT_REQUIRED' });
    }
    if (!provider || !modelId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'LINGXING_MODEL_REQUIRED' });
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
      // argsStr must be a JSON string — objects are not re-stringified by safeParseJSON
      toolResult = await mcpService.callTool({
        argsStr: JSON.stringify({
          campaign_name: campaignName,
          country,
          sku,
        }),
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

    let output: LingxingAnalysisOutput;
    try {
      output = buildLingxingAnalysis(toolResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LINGXING_INVALID_PAYLOAD';
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message,
      });
    }

    // Soft-fail AI polish: keep rule-based report if model errors
    try {
      const ai = new AiGenerationService(this.db, this.userId, input.workspaceId);
      const refined = await ai.generateObject<{ detail: string }>(
        {
          messages: [
            {
              content: `你是亚马逊广告运营分析助手。根据给定的固定规则分析结果，用简洁中文重写「结论」段落。
要求：
- 保留趋势标签含义（持续变差/持续变好/波动较大），不要改成相反判断
- 点明主要驱动（ACoS/CPC/CPO/CVR/订单等）
- 给出 1-2 条可执行下一步
- 2-4 句，不要列表，不要编造未给出的数据`,
              role: 'system',
            },
            {
              content: JSON.stringify(
                {
                  campaignName,
                  country,
                  sku,
                  conclusion: output.analysis.conclusion,
                  baseData: output.analysis.baseData,
                  bidWithOrders: {
                    current: output.analysis.bidWithOrders.current,
                    hits: output.analysis.bidWithOrders.lines
                      .filter((l) => l.hit === '当前命中')
                      .map((l) => ({ action: l.action, title: l.title })),
                  },
                  bidZeroOrders: output.analysis.bidZeroOrders,
                  restore: output.analysis.restore,
                },
                null,
                2,
              ),
              role: 'user',
            },
          ],
          model: modelId,
          provider,
          schema: CONCLUSION_SCHEMA as any,
        },
        {
          metadata: { trigger: 'lingxing-ads-analyze' },
          tracing: {
            scenario: 'business_function_lingxing_ads',
            schemaName: 'lingxing_conclusion',
          },
        },
      );

      const detail = refined?.detail?.trim();
      if (detail) {
        output = {
          ...output,
          analysis: {
            ...output.analysis,
            conclusion: {
              ...output.analysis.conclusion,
              detail,
            },
          },
          markdown: buildV7Markdown({
            ...output.analysis,
            conclusion: {
              ...output.analysis.conclusion,
              detail,
            },
          }),
        };
      }
    } catch {
      // keep deterministic V7 output
    }

    return output;
  };
}
