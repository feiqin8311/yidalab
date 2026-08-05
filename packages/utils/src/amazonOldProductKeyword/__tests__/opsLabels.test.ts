import { describe, expect, it } from 'vitest';

import {
  assignOpsLabel,
  buildKeywordDecision,
  computeGapLabel,
  decideAsin,
  relevanceLabelFromScore,
} from '../opsLabels';
import { DEFAULT_THRESHOLDS } from '../types';

const baseScore = {
  keyword: 'kids scissors',
  keywordKey: 'kids scissors',
  category: '核心词' as const,
  relevanceScore: 82,
  relevanceLabel: '高相关' as const,
  rationale: 'test',
};

describe('relevanceLabelFromScore', () => {
  it('maps thresholds', () => {
    expect(relevanceLabelFromScore(90, DEFAULT_THRESHOLDS)).toBe('核心高相关');
    expect(relevanceLabelFromScore(75, DEFAULT_THRESHOLDS)).toBe('高相关');
    expect(relevanceLabelFromScore(60, DEFAULT_THRESHOLDS)).toBe('中相关');
    expect(relevanceLabelFromScore(40, DEFAULT_THRESHOLDS)).toBe('低相关');
    expect(relevanceLabelFromScore(10, DEFAULT_THRESHOLDS)).toBe('不相关');
  });
});

describe('assignOpsLabel', () => {
  it('marks high-win on orders + efficiency', () => {
    const label = assignOpsLabel(
      baseScore,
      {
        keyword: 'kids scissors',
        keywordKey: 'kids scissors',
        isExactAsin: false,
        current: { orders: 5, clicks: 30, spend: 40, sales: 120 },
      },
      null,
      DEFAULT_THRESHOLDS,
      12,
    );
    expect(label).toBe('高胜率词');
  });

  it('marks negative on irrelevant', () => {
    const label = assignOpsLabel(
      { ...baseScore, relevanceLabel: '不相关', relevanceScore: 10 },
      {
        keyword: 'x',
        keywordKey: 'x',
        isExactAsin: false,
        current: { orders: 0, clicks: 20, spend: 30, sales: 0 },
      },
      null,
      DEFAULT_THRESHOLDS,
      12,
    );
    expect(label).toBe('否词候选');
  });

  it('marks low efficiency on zero-order waste', () => {
    const label = assignOpsLabel(
      baseScore,
      {
        keyword: 'kids scissors',
        keywordKey: 'kids scissors',
        isExactAsin: false,
        current: { orders: 0, clicks: 20, spend: 20, sales: 0 },
      },
      null,
      DEFAULT_THRESHOLDS,
      12, // waste = 6
    );
    expect(label).toBe('广告低效词');
  });

  it('marks history sleep', () => {
    const label = assignOpsLabel(
      baseScore,
      {
        keyword: 'kids scissors',
        keywordKey: 'kids scissors',
        isExactAsin: false,
        history: { orders: 9, clicks: 50 },
        current: { orders: 0, clicks: 1, spend: 0, sales: 0 },
      },
      null,
      DEFAULT_THRESHOLDS,
      12,
    );
    expect(label).toBe('历史沉睡词');
  });
});

describe('gap + asin', () => {
  it('computes natural chase gap', () => {
    expect(
      computeGapLabel({
        keyword: 'a',
        keywordKey: 'a',
        isExactAsin: false,
        multiAsin: {
          ownNaturalRank: 85,
          bestCompNaturalRank: 2,
          compNaturalTop48Count: 5,
          ownPaidPresent: true,
          compPaidCount: 2,
        },
      }),
    ).toBe('自然位追赶');
  });

  it('asin decision priority', () => {
    expect(
      decideAsin({
        asin: 'B0CH9V3V35',
        mainAsin: 'B0CH9V3V35',
        priceUsd: 12,
        thresholds: DEFAULT_THRESHOLDS,
        rest: {},
      }).suggestion,
    ).toBe('自有ASIN，不否定');

    expect(
      decideAsin({
        asin: 'B000UVMNF4',
        mainAsin: 'B0CH9V3V35',
        currentOrders: 3,
        priceUsd: 12,
        thresholds: DEFAULT_THRESHOLDS,
        rest: {},
      }).suggestion,
    ).toBe('转商品投放单独管理');

    expect(
      decideAsin({
        asin: 'B0721MS67V',
        mainAsin: 'B0CH9V3V35',
        currentSpend: 20,
        priceUsd: 12,
        thresholds: DEFAULT_THRESHOLDS,
        rest: {},
      }).suggestion,
    ).toBe('商品否定候选');
  });
});

describe('buildKeywordDecision', () => {
  it('attaches primary source by orders for high-win', () => {
    const d = buildKeywordDecision(
      baseScore,
      {
        keyword: 'kids scissors',
        keywordKey: 'kids scissors',
        isExactAsin: false,
        current: { orders: 5, clicks: 30, spend: 40, sales: 120 },
        sources: [
          { channel: 'SP', campaign: 'A', adGroup: 'g1', orders: 1, spend: 10 },
          { channel: 'SBV', campaign: 'B', adGroup: 'g2', orders: 4, spend: 30 },
        ],
      },
      DEFAULT_THRESHOLDS,
      12,
    );
    expect(d.opsLabel).toBe('高胜率词');
    expect(d.primarySource?.campaign).toBe('B');
    expect(d.sourceComboCount).toBe(2);
  });
});
