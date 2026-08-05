import {
  asNumber,
  formatMetricNumber,
  formatMoney,
  formatPercent,
  formatRange,
  formatWindowLine,
  MISSING,
} from './format';
import { formatConclusionDetail, pickTrendLabel } from './trend';
import type {
  AnalysisSections,
  AnalyzeCampaignResult,
  BidRuleLine,
  NegativeRules,
  NegativeSection,
  RuleHit,
  Thresholds,
  TrendLabel,
} from './types';

const hit = (ok: boolean): RuleHit => (ok ? '当前命中' : '当前不满足');

const line = (title: string, action: string, ok: boolean): BidRuleLine => ({
  action,
  hit: hit(ok),
  title,
});

const formatNegativeHits = (rules?: NegativeRules | null): NegativeSection => {
  const keywordHits: string[] = [];
  const asinHits: string[] = [];
  for (const item of rules?.keyword || []) {
    const q = item?.query?.trim();
    if (!q) continue;
    const clicks = asNumber(item.clicks);
    keywordHits.push(
      clicks === null
        ? `query：${q} → 精否`
        : `query：${q}（${formatMetricNumber(clicks)} clicks）→ 精否`,
    );
  }
  for (const item of rules?.asin || []) {
    const q = item?.query?.trim();
    if (!q) continue;
    const clicks = asNumber(item.clicks);
    asinHits.push(
      clicks === null
        ? `ASIN：${q} → 精否`
        : `ASIN：${q}（${formatMetricNumber(clicks)} clicks）→ 精否`,
    );
  }
  return {
    asinHits,
    keywordHits,
    noneLabel: '当前无命中',
  };
};

const thresholdLines = (t?: Thresholds | null): string[] => {
  if (!t) return [`- ${MISSING}`];
  return [
    `- 超高 ACoS（×1.5）：${formatPercent(t.acos_ultra)}`,
    `- 高 ACoS（×1.2）：${formatPercent(t.acos_high)}`,
    `- 低 ACoS（×0.8）：${formatPercent(t.acos_low)}`,
    `- 高 CVR（×1.2）：${formatPercent(t.cvr_high)}`,
    `- 低 CVR（×0.8）：${formatPercent(t.cvr_low)}`,
    `- 高 CPO（×1.5）：${formatMoney(t.cpo_high_click)}`,
    `- 低 CPO（×0.5）：${formatMoney(t.cpo_low_click)}`,
    `- 双倍 CPO（×2）：${formatMoney(t.cpo_double)}`,
    `- 出单加价上限 bid_up_cap：${formatMoney(t.bid_up_cap)}`,
    `- 零单加价上限 bid_zero_order_up_cap：${formatMoney(t.bid_zero_order_up_cap)}`,
  ];
};

export const buildAnalysisSections = (result: AnalyzeCampaignResult): AnalysisSections => {
  const label: TrendLabel = pickTrendLabel(
    result.trend?.label,
    result.compare_7d,
    result.compare_14d,
  );
  const t = result.thresholds || {};
  const cur14 = result.compare_14d?.current;
  const acos = asNumber(cur14?.acos);
  const orders = asNumber(cur14?.orders);
  const cpo = asNumber(cur14?.cpo);

  const acosLow = asNumber(t.acos_low);
  const acosHigh = asNumber(t.acos_high);
  const acosUltra = asNumber(t.acos_ultra);
  const cpoHigh = asNumber(t.cpo_high_click);
  const cpoLow = asNumber(t.cpo_low_click);
  const bidUpCap = asNumber(t.bid_up_cap);
  const bidZeroUpCap = asNumber(t.bid_zero_order_up_cap);

  // Distinguish known zero / known positive / missing — never treat missing as zero.
  const ordersKnown = orders !== null;
  const hasOrders = ordersKnown && orders > 0;
  const zeroOrders = ordersKnown && orders === 0;
  const ordersN = ordersKnown ? orders : 0;

  const lowHit = hasOrders && acos !== null && acosLow !== null && acos <= acosLow && ordersN >= 3;
  const highHit =
    hasOrders && acos !== null && acosHigh !== null && acos >= acosHigh && ordersN >= 3;
  const ultraHit =
    hasOrders && acos !== null && acosUltra !== null && acos >= acosUltra && ordersN >= 2;
  const anyWithOrderHit = lowHit || highHit || ultraHit;

  const zeroHighHit = zeroOrders && cpo !== null && cpoHigh !== null && cpo > cpoHigh;
  const zeroLowHit = zeroOrders && cpo !== null && cpoLow !== null && cpo < cpoLow;
  const anyZeroHit = zeroHighHit || zeroLowHit;

  const bidWithOrdersLines: BidRuleLine[] = [
    line(
      `低 ACoS（≤${formatPercent(acosLow)}）且≥3单`,
      `bid +5%，上限=${formatMoney(bidUpCap)}，频率=5天/次`,
      lowHit,
    ),
    line(
      `高 ACoS（≥${formatPercent(acosHigh)}）3单及以上`,
      `bid -5%，下限=$0.1，频率=3天/次`,
      highHit,
    ),
    line(
      `超高 ACoS（≥${formatPercent(acosUltra)}）2单以上`,
      `bid -10% 或 -$0.1，下限=$0.1；预算 -$10，频率=5天/次`,
      ultraHit,
    ),
    line('其余情况', '维持原状，保持不变', hasOrders && !anyWithOrderHit),
  ];

  const bidZeroLines: BidRuleLine[] = [
    line(
      `高点击 CPO（>${formatMoney(cpoHigh)}）且 Orders=0`,
      'bid -$0.1 或 -10%，下限 $0.1，频率=3天/次',
      zeroHighHit,
    ),
    line(
      `低点击 CPO（<${formatMoney(cpoLow)}）且 Orders=0`,
      `bid +$0.05 或 +10%，上限=${formatMoney(bidZeroUpCap)}，频率=3天/次`,
      zeroLowHit,
    ),
    line('其余情况', '维持原状，保持不变', zeroOrders && !anyZeroHit),
  ];

  const bestWeek = result.best_week
    ? formatWindowLine(
        '最佳连续7天',
        result.best_week as {
          acos?: number | null;
          cpc?: number | null;
          cpo?: number | null;
          cvr?: number | null;
          end?: string | null;
          orders?: number | null;
          start?: string | null;
        },
      )
    : null;

  const bid = asNumber(result.recommended_settings?.Bid ?? result.recommended_settings?.bid);

  return {
    baseData: {
      bestWeek: label === '持续变差' ? bestWeek : null,
      compare14d: [
        formatWindowLine('近14天', result.compare_14d?.current),
        formatWindowLine('前14天', result.compare_14d?.previous),
      ],
      compare30d: [
        formatWindowLine('近30天', result.compare_30d?.current),
        formatWindowLine('前30天', result.compare_30d?.previous),
      ],
      compare7d: [
        formatWindowLine('近7天', result.compare_7d?.current),
        formatWindowLine('前7天', result.compare_7d?.previous),
      ],
      sku14d: result.sku_14d_all
        ? `- 全品14天汇总（${formatRange(result.sku_14d_all.start, result.sku_14d_all.end)}）：ACoS ${formatPercent(result.sku_14d_all.acos)}，CVR ${formatPercent(result.sku_14d_all.cvr)}，CPO ${formatMoney(result.sku_14d_all.cpo)}`
        : null,
      sku30d: result.sku_30d_all
        ? `- 全品30天汇总（${formatRange(result.sku_30d_all.start, result.sku_30d_all.end)}）：ACoS ${formatPercent(result.sku_30d_all.acos)}，CVR ${formatPercent(result.sku_30d_all.cvr)}，CPO ${formatMoney(result.sku_30d_all.cpo)}`
        : null,
      thresholds: thresholdLines(result.thresholds),
    },
    bidWithOrders: {
      current: `- 当前单活动近14天：ACoS ${formatPercent(acos)} / CVR ${formatPercent(cur14?.cvr)} / CPO ${formatMoney(cpo)} / Orders ${orders === null ? MISSING : formatMetricNumber(orders)}`,
      lines: bidWithOrdersLines,
      volatilityNote:
        label === '波动较大' ? '波动较大，竞价建议维持原状，继续观察，不执行上述调整。' : null,
    },
    bidZeroOrders: {
      // Only apply zero-order branch when Orders is known to be 0.
      applicable: zeroOrders,
      lines: bidZeroLines,
      note: !ordersKnown
        ? `Orders ${MISSING}，本节不给出调价命中（仅列出规则原文）。`
        : hasOrders
          ? '本节规则不适用。列出原始规则供参考。'
          : null,
    },
    conclusion: {
      detail: formatConclusionDetail(label, result.compare_7d, result.compare_14d),
      label,
    },
    negativeAd: formatNegativeHits(result.negative_rules_ad),
    negativeAdGroups: formatNegativeHits(result.negative_rules_ad_groups),
    negativeTarget: formatNegativeHits(result.negative_rules_target),
    restore: {
      applicable: label === '持续变差',
      lines:
        label === '持续变差'
          ? [
              `- Bid = ${bid === null ? MISSING : formatMoney(bid)}`,
              bestWeek || `- 最佳周：${MISSING}`,
            ]
          : ['- 非持续变差，本节不适用'],
    },
  };
};
