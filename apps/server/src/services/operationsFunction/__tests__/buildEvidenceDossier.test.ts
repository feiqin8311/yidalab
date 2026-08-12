// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEvidenceDossier } from '../buildEvidenceDossier';

const { findByIdentifier, findByIdentifierGlobal, callTool } = vi.hoisted(() => ({
  callTool: vi.fn(),
  findByIdentifier: vi.fn(),
  findByIdentifierGlobal: vi.fn(),
}));

vi.mock('@/database/models/companyMarketMcp', () => ({
  CompanyMarketMcpModel: class {
    static findByIdentifierGlobal = findByIdentifierGlobal;
    findByIdentifier = findByIdentifier;
    constructor(
      public db: unknown,
      public workspaceId: string,
    ) {}
  },
}));

vi.mock('@/server/services/mcp', () => ({
  mcpService: { callTool },
}));

describe('buildEvidenceDossier workspace isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callTool.mockResolvedValue({ content: 'ok', success: true });
  });

  it('never calls findByIdentifierGlobal for connections', async () => {
    findByIdentifier.mockResolvedValue(undefined);
    findByIdentifierGlobal.mockResolvedValue({
      connection: { auth: { token: 'OTHER_WS_SECRET', type: 'bearer' }, url: 'https://evil' },
      identifier: 'company.mcp.lingxing-mcp',
      tools: [{ name: 'ads_get_asin_ad_structure' }],
    });

    const result = await buildEvidenceDossier({
      db: {} as any,
      params: { asin: 'B01', marketplace: 'US' },
      pluginIds: ['company.mcp.sif-mcp'], // lingxing not installed
      toolApis: [
        {
          apiName: 'ads_get_asin_ad_structure',
          identifier: 'company.mcp.lingxing-mcp',
          type: 'mcp',
        },
      ],
      workspaceId: 'ws-a',
    });

    expect(findByIdentifierGlobal).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
    // Optional plugin dropped by rewrite — no steps → null
    expect(result).toBeNull();
  });

  it('uses workspace row only when installed', async () => {
    findByIdentifier.mockResolvedValue({
      connection: { type: 'http', url: 'https://sif.local' },
      identifier: 'company.mcp.sif-mcp',
      tools: [{ name: 'ops_get_asin_traffic_trend' }],
    });

    const result = await buildEvidenceDossier({
      db: {} as any,
      params: { asin: 'B01', marketplace: 'US' },
      pluginIds: ['company.mcp.sif-mcp'],
      toolApis: [
        {
          apiName: 'ops_get_asin_traffic_trend',
          identifier: 'company.mcp.sif-mcp',
          type: 'mcp',
        },
      ],
      workspaceId: 'ws-a',
    });

    expect(findByIdentifierGlobal).not.toHaveBeenCalled();
    expect(findByIdentifier).toHaveBeenCalledWith('company.mcp.sif-mcp');
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result?.text).toContain('ops_get_asin_traffic_trend');
  });

  it('rewrites DAG id to installed alias (sif-mcp)', async () => {
    findByIdentifier.mockImplementation(async (id: string) => {
      if (id === 'sif-mcp') {
        return {
          connection: { type: 'http', url: 'https://sif.local' },
          identifier: 'sif-mcp',
          tools: [{ name: 'ops_get_asin_traffic_trend' }],
        };
      }
      return undefined;
    });

    const result = await buildEvidenceDossier({
      db: {} as any,
      params: { asin: 'B01', marketplace: 'US' },
      pluginIds: ['sif-mcp'],
      toolApis: [
        {
          apiName: 'ops_get_asin_traffic_trend',
          identifier: 'company.mcp.sif-mcp',
          type: 'mcp',
        },
      ],
      workspaceId: 'ws-a',
    });

    expect(findByIdentifier).toHaveBeenCalledWith('sif-mcp');
    expect(findByIdentifierGlobal).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result?.toolCalls).toBe(1);
  });
});
