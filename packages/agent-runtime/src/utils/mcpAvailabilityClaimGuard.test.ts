import { describe, expect, it } from 'vitest';

import {
  applyMcpAvailabilityClaimGuard,
  countToolApiCallsByIdentifier,
  extractActivatedMcps,
  type McpClaimGuardMessage,
} from './mcpAvailabilityClaimGuard';

const activateMcps = (
  tools: Array<{ identifier: string; name: string }>,
): McpClaimGuardMessage => ({
  plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
  pluginState: {
    activatedTools: tools.map((t) => ({
      apiCount: 1,
      identifier: t.identifier,
      name: t.name,
    })),
    notFound: [],
  },
  role: 'tool',
});

const mcpCall = (identifier: string, apiName: string): McpClaimGuardMessage => ({
  content: JSON.stringify({ ok: true }),
  plugin: { apiName, identifier },
  role: 'tool',
});

describe('extractActivatedMcps', () => {
  it('reads company.mcp.* from activateTools state', () => {
    const mcps = extractActivatedMcps([
      activateMcps([
        { identifier: 'company.mcp.sellersprite-mcp', name: 'sellersprite-mcp' },
        { identifier: 'company.mcp.sif-mcp', name: 'sif-mcp' },
        { identifier: 'lobe-web-browsing', name: 'web' },
      ]),
    ]);
    expect(mcps.map((m) => m.identifier).sort()).toEqual([
      'company.mcp.sellersprite-mcp',
      'company.mcp.sif-mcp',
    ]);
    expect(mcps.find((m) => m.identifier.includes('sellersprite'))?.display).toBe('卖家精灵');
  });
});

describe('countToolApiCallsByIdentifier', () => {
  it('ignores activator and counts business MCP calls', () => {
    const counts = countToolApiCallsByIdentifier([
      activateMcps([{ identifier: 'company.mcp.sif-mcp', name: 'sif-mcp' }]),
      mcpCall('company.mcp.sif-mcp', 'ops_get_asin_traffic_trend'),
      mcpCall('company.mcp.sif-mcp', 'market_get_keyword_history'),
    ]);
    expect(counts.get('company.mcp.sif-mcp')).toBe(2);
    expect(counts.get('lobe-activator')).toBeUndefined();
  });
});

describe('applyMcpAvailabilityClaimGuard', () => {
  const baseMessages: McpClaimGuardMessage[] = [
    activateMcps([
      { identifier: 'company.mcp.sif-mcp', name: 'sif-mcp' },
      { identifier: 'company.mcp.lingxing-mcp', name: 'lingxing-mcp' },
      { identifier: 'company.mcp.sellersprite-mcp', name: 'sellersprite-mcp' },
    ]),
    mcpCall('company.mcp.sif-mcp', 'ops_get_asin_traffic_trend'),
    mcpCall('company.mcp.lingxing-mcp', 'query_campaign_ads'),
  ];

  it('is a no-op without activation messages', () => {
    expect(applyMcpAvailabilityClaimGuard('卖家精灵密钥已过期', [])).toBe('卖家精灵密钥已过期');
  });

  it('is a no-op when the MCP was actually called', () => {
    const messages = [...baseMessages, mcpCall('company.mcp.sellersprite-mcp', 'search_products')];
    const text = '卖家精灵密钥已过期，无法使用';
    expect(applyMcpAvailabilityClaimGuard(text, messages)).toBe(text);
  });

  it('rewrites false key-expired claim when sellersprite activated but never called', () => {
    const text =
      '卖家精灵密钥已过期，无法使用。但 SIF 和领星可用。现在并行查询：领星获取广告活动，SIF 获取竞品流量。';
    const guarded = applyMcpAvailabilityClaimGuard(text, baseMessages);
    expect(guarded).toContain('已激活但未调用「卖家精灵」');
    expect(guarded).toContain('非密钥校验失败');
    expect(guarded).not.toMatch(/卖家精灵密钥已过期/);
    expect(guarded).toContain('SIF 和领星可用');
  });

  it('rewrites report badge style copy', () => {
    const html =
      '数据源：SIF MCP + 领星 MCP + 用户利润测算 · 卖家精灵：密钥过期，不可用 · 结论等级：需修正';
    const guarded = applyMcpAvailabilityClaimGuard(html, baseMessages);
    expect(guarded).toContain('已激活但未调用「卖家精灵」');
    expect(guarded).not.toMatch(/密钥过期，不可用/);
  });

  it('does not rewrite unrelated unavailability copy', () => {
    const text = '今日服务暂时不可用，请稍后重试。';
    expect(applyMcpAvailabilityClaimGuard(text, baseMessages)).toBe(text);
  });
});
