import { describe, expect, it } from 'vitest';

import { buildLingxingAnalysis } from './index';
import { parseAnalyzeCampaignResult } from './parse';
import { buildAnalysisSections } from './rules';
import { acosDirection, computeTrendLabel } from './trend';

const window = (acos: number, orders = 3, cpo = 10) => ({
  acos,
  cpc: 0.5,
  cpo,
  cvr: 0.1,
  end: '2026-08-01',
  orders,
  start: '2026-07-25',
});

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  compare_14d: {
    current: window(0.3, 5, 12),
    previous: window(0.25, 4, 11),
  },
  compare_30d: {
    current: window(0.28),
    previous: window(0.27),
  },
  compare_7d: {
    current: window(0.35, 2, 15),
    previous: window(0.3, 2, 14),
  },
  negative_rules_ad: { asin: [], keyword: [] },
  negative_rules_ad_groups: {
    asin: [],
    keyword: [{ clicks: 40, query: 'cheap case' }],
  },
  negative_rules_target: { asin: [], keyword: [] },
  sku_14d_all: window(0.2, 20, 8),
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
  ...overrides,
});

describe('lingxingAds trend', () => {
  it('acosDirection zero boundaries', () => {
    expect(acosDirection(0.1, 0)).toBe('变好');
    expect(acosDirection(0, 0.1)).toBe('变差');
    expect(acosDirection(0, 0)).toBe('持平');
    expect(acosDirection(0.2, 0.3)).toBe('变好');
    expect(acosDirection(0.3, 0.2)).toBe('变差');
  });

  it('computeTrendLabel both worse → 持续变差', () => {
    expect(
      computeTrendLabel(
        { current: window(0.4), previous: window(0.3) },
        { current: window(0.35), previous: window(0.25) },
      ),
    ).toBe('持续变差');
  });

  it('computeTrendLabel both better/flat → 持续变好', () => {
    expect(
      computeTrendLabel(
        { current: window(0.2), previous: window(0.3) },
        { current: window(0.22), previous: window(0.22) },
      ),
    ).toBe('持续变好');
  });

  it('computeTrendLabel mixed → 波动较大', () => {
    expect(
      computeTrendLabel(
        { current: window(0.4), previous: window(0.3) },
        { current: window(0.2), previous: window(0.3) },
      ),
    ).toBe('波动较大');
  });

  it('prev14 has data and cur14 acos=0 → 持续变差', () => {
    expect(
      computeTrendLabel(
        { current: window(0.1), previous: window(0.2) },
        { current: window(0), previous: window(0.2) },
      ),
    ).toBe('持续变差');
  });
});

describe('lingxingAds rules', () => {
  it('orders>0 high acos hits bid down', () => {
    const sections = buildAnalysisSections(
      parseAnalyzeCampaignResult(
        basePayload({
          compare_14d: {
            current: window(0.32, 5, 12),
            previous: window(0.25, 4, 11),
          },
          compare_7d: {
            current: window(0.4, 2, 15),
            previous: window(0.3, 2, 14),
          },
        }),
      ),
    );
    expect(sections.conclusion.label).toBe('持续变差');
    const ultra = sections.bidWithOrders.lines.find((l) => l.title.includes('超高'));
    expect(ultra?.hit).toBe('当前命中');
    expect(sections.bidZeroOrders.applicable).toBe(false);
    expect(sections.restore.applicable).toBe(true);
  });

  it('orders=0 high cpo hits zero-order rule', () => {
    const sections = buildAnalysisSections(
      parseAnalyzeCampaignResult(
        basePayload({
          compare_14d: {
            current: window(0.2, 0, 20),
            previous: window(0.2, 0, 18),
          },
          compare_7d: {
            current: window(0.2, 0, 19),
            previous: window(0.2, 0, 18),
          },
          trend: { label: '持续变好' },
        }),
      ),
    );
    expect(sections.bidZeroOrders.applicable).toBe(true);
    const high = sections.bidZeroOrders.lines.find((l) => l.title.includes('高点击'));
    expect(high?.hit).toBe('当前命中');
  });

  it('missing orders does not count as zero-order bid hits', () => {
    const sections = buildAnalysisSections(
      parseAnalyzeCampaignResult(
        basePayload({
          compare_14d: {
            current: { acos: 0.2, cpc: 0.5, cpo: 20, cvr: 0.1, orders: null },
            previous: window(0.2, 0, 18),
          },
          compare_7d: {
            current: { acos: 0.2, cpc: 0.5, cpo: 19, cvr: 0.1 },
            previous: window(0.2, 0, 18),
          },
          trend: { label: '持续变好' },
        }),
      ),
    );
    expect(sections.bidZeroOrders.applicable).toBe(false);
    expect(sections.bidZeroOrders.note).toContain('数据缺失');
    expect(sections.bidZeroOrders.lines.every((l) => l.hit === '当前不满足')).toBe(true);
  });

  it('negative hits and missing optional fields', () => {
    const sections = buildAnalysisSections(
      parseAnalyzeCampaignResult(
        basePayload({
          best_week: null,
          recommended_settings: null,
          sku_30d_all: null,
        }),
      ),
    );
    expect(sections.negativeAdGroups.keywordHits[0]).toContain('cheap case');
    expect(sections.baseData.sku30d).toBeNull();
  });

  it('volatility keeps bid observe note', () => {
    const sections = buildAnalysisSections(
      parseAnalyzeCampaignResult(
        basePayload({
          compare_14d: {
            current: window(0.2),
            previous: window(0.3),
          },
          compare_7d: {
            current: window(0.4),
            previous: window(0.3),
          },
          trend: { label: '波动较大' },
        }),
      ),
    );
    expect(sections.conclusion.label).toBe('波动较大');
    expect(sections.bidWithOrders.volatilityNote).toContain('维持原状');
  });
});

describe('lingxingAds parse + markdown', () => {
  it('unwraps result wrapper', () => {
    const out = buildLingxingAnalysis({ result: basePayload() });
    expect(out.analysis.conclusion.label).toBeTruthy();
    expect(out.markdown).toContain('## 1) 结论');
    expect(out.markdown).toContain('## 8) 复原推荐参数');
    expect(out.markdown).toContain('其余情况 — 动作：维持原状，保持不变');
    expect(out.source.identifier).toBe('company.mcp.lingxing-mcp');
    expect(out.source.toolName).toBe('analyze_campaign');
  });

  it('rejects incomplete payload', () => {
    expect(() => parseAnalyzeCampaignResult({ foo: 1 })).toThrow('LINGXING_INCOMPLETE_PAYLOAD');
  });

  it('marks missing metrics without inventing zeros', () => {
    const out = buildLingxingAnalysis({
      compare_14d: { current: { acos: null }, previous: null },
      compare_7d: { current: null, previous: null },
      thresholds: {},
      trend: { label: '波动较大' },
    });
    expect(out.markdown).toContain('数据缺失');
    expect(out.markdown).not.toMatch(/ACoS 0\.00%/);
  });

  it('parses live MCP wire format (display strings + aliases)', () => {
    const live = {
      status: 'ok',
      result: {
        trend: { label: '波动较大' },
        compare_7d: {
          current: {
            date_range: '2026-08-03~2026-08-09',
            CPC: '$1.33',
            ACoS: '52.47%',
            CVR: '12.12%',
            CPO: 8.25,
            orders: 4,
          },
          prev: {
            date_range: '2026-07-27~2026-08-02',
            CPC: '$1.24',
            ACoS: '0.00%',
            CVR: '0.00%',
            CPO: 0,
            orders: 0,
          },
        },
        compare_14d: {
          current: {
            date_range: '2026-07-27~2026-08-09',
            CPC: '$1.29',
            ACoS: '98.54%',
            CVR: '6.25%',
            CPO: 16,
            orders: 4,
          },
          prev: {
            date_range: '2026-07-13~2026-07-26',
            CPC: '$1.29',
            ACoS: '11.12%',
            CVR: '31.91%',
            CPO: 3.13,
            orders: 15,
          },
        },
        compare_30d: {
          current: {
            date_range: '2026-07-11~2026-08-09',
            ACoS: '34.19%',
            orders: 19,
            CPO: 9.79,
            CVR: '10.00%',
            CPC: '$1.30',
          },
          prev: {
            date_range: '2026-06-11~2026-07-10',
            ACoS: '42.16%',
            orders: 10,
            CPO: 8,
            CVR: '12.50%',
            CPC: '$1.29',
          },
        },
        sku_14d_all: {
          date_range: '2026-07-27~2026-08-09',
          ACoS: '31.94%',
          CVR: '14.53%',
          CPO: 6.88,
        },
        thresholds: {
          acos_super_high: 0.4791,
          acos_high: 0.3833,
          acos_low: 0.2555,
          cvr_high: 0.1744,
          cvr_low: 0.1162,
          cpo_high_click: 10.32,
          cpo_low_click: 3.44,
          double_cpo: 13.76,
          bid_up_cap: 1.664,
          bid_zero_order_up_cap: 1.536,
        },
        negative_rules_ad: [],
        negative_rules_ad_groups: [],
        negative_rules_target: [],
      },
    };

    const out = buildLingxingAnalysis(live);
    expect(out.markdown).toContain('近7天（2026-08-03~2026-08-09）');
    expect(out.markdown).toContain('CPC $1.33');
    expect(out.markdown).toContain('ACoS 52.47%');
    expect(out.markdown).toContain('CVR 12.12%');
    expect(out.markdown).toContain('CPO $8.25');
    expect(out.markdown).toContain('Orders 4');
    expect(out.markdown).toContain('超高 ACoS（×1.5）：47.91%');
    expect(out.markdown).toContain('双倍 CPO（×2）：$13.76');
    expect(out.markdown).not.toContain('数据缺失');
    // 近14d ACoS 98.54% ≥ ultra 47.91% and orders 4 ≥ 2
    const ultra = out.analysis.bidWithOrders.lines.find((l) => l.title.includes('超高'));
    expect(ultra?.hit).toBe('当前命中');
  });
});
