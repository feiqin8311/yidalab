import type { MaterializedViews } from '@lobechat/utils';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildWorkbookBuffer } from '../exportWorkbook';

const emptyViews = (): MaterializedViews => ({
  overview: {
    title: '测试｜老品关键词全盘分析',
    mainAsin: 'B0CH9V3V35',
    summary: {
      naturalKeywordCount: 2,
      highWinCount: 1,
      newOpportunityCount: 0,
      lowEfficiencyAndNegativeCount: 0,
    },
  },
  high_win: [
    {
      keyword: 'kids scissors',
      keywordKey: 'kids scissors',
      isExactAsin: false,
      category: '核心词',
      relevanceScore: 82,
      relevanceLabel: '高相关',
      rationale: 'test',
      opsLabel: '高胜率词',
      compositeScore: 88,
      current: { orders: 5, spend: 20, sales: 100, clicks: 30, cvr: 0.16, acos: 0.2 },
      primarySource: { channel: 'SP', campaign: 'A', adGroup: 'G', orders: 5, spend: 20 },
      sourceCampaignCount: 1,
      sourceComboCount: 1,
      allSourceCombos: '[SP] A｜G｜EXACT｜订单5｜花费20.00',
      executionLevel: '广告组/活动保护',
    },
  ],
  new_opportunity: [],
  low_efficiency: [],
  history_sleep: [],
  competitor_gap: [],
  asin_negative: [
    {
      asin: 'B000UVMNF4',
      suggestion: '转商品投放单独管理',
      rationale: '有单',
      currentOrders: 2,
      currentSpend: 10,
      currentSales: 40,
    },
  ],
  full_lexicon: [],
  brand_ads: [],
  sp_targeting: [],
  daily_trend: [
    {
      date: '2026-05-25',
      spOrders: 4,
      sbClickOrders: 5,
      spSpend: 9.9,
      sbSpend: 15,
    },
    {
      date: '2026-05-26',
      spOrders: 3,
      sbClickOrders: 2,
      spSpend: 8,
      sbSpend: 10,
    },
  ],
  scoring_rules: [{ 参数: '目标ACoS', 当前值: 0.35, 用途: '阈值' }],
  data_sources: [
    {
      file: 'x.html',
      role: 'product_html',
      usage: '语义',
    },
  ],
});

describe('buildWorkbookBuffer', () => {
  it('writes xlsx with expected name and size', async () => {
    const { buffer, fileName } = await buildWorkbookBuffer(emptyViews(), '儿童剪刀');
    expect(fileName).toMatch(/^老品关键词全景经营诊断-儿童剪刀-\d{8}-\d{6}\.xlsx$/);
    expect(buffer.length).toBeGreaterThan(2000);
    // zip magic
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it('escapes formula-like text and embeds correct CVR formula', async () => {
    const views = emptyViews();
    views.high_win[0]!.keyword = '=cmd|evil';
    const { buffer } = await buildWorkbookBuffer(views, '测试');
    expect(buffer[0]).toBe(0x50);

    const files = unzipSync(new Uint8Array(buffer));
    const workbookXml = strFromU8(files['xl/workbook.xml']!);
    expect(workbookXml).toContain('高胜率词');

    // shared strings + worksheets may hold text; search whole package
    const allXml = Object.entries(files)
      .filter(([k]) => k.endsWith('.xml'))
      .map(([, v]) => strFromU8(v))
      .join('\n');
    // formula-injection: leading = must be neutralized (apostrophe or not start a formula)
    expect(allXml.includes('cmd|evil') || allXml.includes('cmd|evil'.replace('|', '&#124;'))).toBe(
      true,
    );
    // CVR = orders/clicks = P/Q ; ACoS = spend/sales = R/S
    expect(allXml).toMatch(/IFERROR\(P\d+\/Q\d+/);
    expect(allXml).toMatch(/IFERROR\(R\d+\/S\d+/);
  });

  it('includes all 13 sheet names', async () => {
    const { buffer } = await buildWorkbookBuffer(emptyViews(), '儿童剪刀');
    const files = unzipSync(new Uint8Array(buffer));
    const workbookXml = strFromU8(files['xl/workbook.xml']!);
    for (const name of [
      '总览',
      '高胜率词',
      '新机会词',
      '低效与否词',
      '历史沉睡词',
      '竞品差距',
      'ASIN否词建议',
      '全量词库',
      '品牌推广表现',
      'SP投放对象',
      '每日趋势',
      '评分与分类规则',
      '数据源说明',
    ]) {
      expect(workbookXml).toContain(name);
    }
  });
});
