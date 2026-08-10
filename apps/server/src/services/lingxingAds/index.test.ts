import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LingxingAdsService } from './index';

const { findByIdentifier, callTool } = vi.hoisted(() => ({
  callTool: vi.fn(),
  findByIdentifier: vi.fn(),
}));

vi.mock('@/database/models/companyMarketMcp', () => ({
  CompanyMarketMcpModel: class {
    findByIdentifier = findByIdentifier;
    constructor(
      _db: unknown,
      public workspaceId: string,
    ) {}
  },
}));

vi.mock('@/server/services/mcp', () => ({
  mcpService: { callTool },
}));

const sampleResult = {
  compare_14d: {
    current: { acos: 0.3, cpc: 0.5, cpo: 10, cvr: 0.1, orders: 5 },
    previous: { acos: 0.25, cpc: 0.4, cpo: 9, cvr: 0.1, orders: 4 },
  },
  compare_7d: {
    current: { acos: 0.35, cpc: 0.5, cpo: 11, cvr: 0.1, orders: 2 },
    previous: { acos: 0.3, cpc: 0.4, cpo: 10, cvr: 0.1, orders: 2 },
  },
  thresholds: {
    acos_high: 0.24,
    acos_low: 0.16,
    acos_ultra: 0.3,
    bid_up_cap: 1.3,
    bid_zero_order_up_cap: 1,
    cpo_double: 16,
    cpo_high_click: 12,
    cpo_low_click: 4,
    cvr_high: 0.12,
    cvr_low: 0.08,
  },
  trend: { label: '持续变差' },
};

const baseInput = {
  campaignName: 'camp',
  country: 'US',
  model: { model: 'gpt-4o-mini', provider: 'openai' },
  sku: 'SKU1',
  workspaceId: 'ws-1',
};

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = vi.fn().mockRejectedValue(new Error('skip polish in unit tests'));
  },
}));

describe('LingxingAdsService', () => {
  const service = new LingxingAdsService({} as any, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
    findByIdentifier.mockResolvedValue({
      connection: { type: 'http', url: 'https://mcp.example/lingxing' },
      identifier: 'company.mcp.lingxing-mcp',
      workspaceId: 'ws-1',
    });
    callTool.mockResolvedValue({
      content: JSON.stringify({ result: sampleResult }),
      state: { isError: false },
      success: true,
    });
  });

  it('rejects empty inputs after trim', async () => {
    await expect(service.analyze({ ...baseInput, campaignName: '  ' })).rejects.toMatchObject({
      message: 'LINGXING_INPUT_REQUIRED',
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('rejects missing model', async () => {
    await expect(
      service.analyze({ ...baseInput, model: { model: '', provider: 'openai' } }),
    ).rejects.toMatchObject({ message: 'LINGXING_MODEL_REQUIRED' });
  });

  it('isolates workspace and errors when MCP missing', async () => {
    findByIdentifier.mockResolvedValueOnce(undefined);
    await expect(
      service.analyze({
        ...baseInput,
        campaignName: 'camp',
        country: '美国',
        workspaceId: 'ws-missing',
      }),
    ).rejects.toMatchObject({ message: 'LINGXING_MCP_NOT_CONFIGURED' });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('maps params and calls analyze_campaign once', async () => {
    const out = await service.analyze({
      ...baseInput,
      campaignName: ' 活动A ',
      country: ' 美国 ',
      sku: ' SKU1 ',
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({
      argsStr: JSON.stringify({ campaign_name: '活动A', country: '美国', sku: 'SKU1' }),
      clientParams: {
        name: 'company.mcp.lingxing-mcp',
        type: 'http',
        url: 'https://mcp.example/lingxing',
      },
      toolName: 'analyze_campaign',
    });
    expect(out.markdown).toContain('## 1) 结论');
    expect(out.source.toolName).toBe('analyze_campaign');
  });

  it('surfaces transport errors', async () => {
    callTool.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(service.analyze(baseInput)).rejects.toMatchObject({
      message: expect.stringContaining('LINGXING_MCP_CALL_FAILED'),
    });
  });

  it('surfaces business isError from MCP', async () => {
    callTool.mockResolvedValueOnce({
      content: 'campaign not found',
      state: { isError: true },
      success: true,
    });
    await expect(service.analyze(baseInput)).rejects.toMatchObject({
      message: expect.stringContaining('LINGXING_ANALYZE_FAILED'),
    });
  });

  it('rejects incomplete payload', async () => {
    callTool.mockResolvedValueOnce({
      content: JSON.stringify({ hello: 'world' }),
      state: { isError: false },
      success: true,
    });
    await expect(service.analyze(baseInput)).rejects.toMatchObject({
      message: 'LINGXING_INCOMPLETE_PAYLOAD',
    });
  });
});
