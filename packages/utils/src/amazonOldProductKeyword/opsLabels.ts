/** Ops labels, gap labels, composite score, ASIN decisions — pure rules. */

import { cvr, safeDiv } from './metrics';
import type {
  AnalysisThresholds,
  AsinDecision,
  GapLabel,
  KeywordDecision,
  KeywordEvidence,
  KeywordSemanticScore,
  OpsLabel,
} from './types';

export const relevanceLabelFromScore = (
  score: number,
  thresholds: AnalysisThresholds,
): KeywordSemanticScore['relevanceLabel'] => {
  if (score >= thresholds.coreRelevanceScore) return '核心高相关';
  if (score >= thresholds.highRelevanceScore) return '高相关';
  if (score >= 55) return '中相关';
  if (score >= 35) return '低相关';
  return '不相关';
};

export const isHighRelevance = (label: string) => label === '核心高相关' || label === '高相关';

export const wasteSpendThreshold = (priceUsd: number, thresholds: AnalysisThresholds) =>
  priceUsd * thresholds.wasteSpendRatioToPrice;

export const computeGapLabel = (ev: KeywordEvidence): GapLabel | null => {
  const m = ev.multiAsin;
  if (!m) return null;
  const own = m.ownNaturalRank ?? null;
  const best = m.bestCompNaturalRank ?? null;
  const ownPaid = !!m.ownPaidPresent;
  const compPaid = m.compPaidCount ?? 0;
  const top20 = m.compNaturalTop20Count ?? 0;
  const top48 = m.compNaturalTop48Count ?? 0;

  if (best != null && best <= 48 && (own == null || own > 48)) return '自然位追赶';
  if (own != null && best != null && own <= 48 && best <= 48 && own > best + 5) return '首屏内落后';
  if (compPaid >= 2 && !ownPaid) return '广告竞争缺口';
  if (ownPaid && top48 <= 1 && compPaid === 0) return '我方独投（复核）';
  if (own != null && own <= 20 && ownPaid && compPaid <= 1) return '自然已强/广告防守复核';
  if (own != null && own <= 20 && (best == null || own <= best)) return '自然领先';
  if ((own == null || own > 48) && top20 === 0) return '自然覆盖弱';
  return '差距有限/观察';
};

export const computeCompositeScore = (score: KeywordSemanticScore, ev: KeywordEvidence): number => {
  const semantic = Math.min(40, (score.relevanceScore / 100) * 40);
  const curOrders = ev.current?.orders ?? 0;
  const curClicks = ev.current?.clicks ?? 0;
  const curSpend = ev.current?.spend ?? 0;
  const curSales = ev.current?.sales ?? 0;
  const histOrders = ev.history?.orders ?? 0;

  const orderEvidence = Math.min(15, Math.log1p(curOrders) * 6);
  const cvrScore = curClicks > 0 ? Math.min(10, (cvr(curOrders, curClicks) ?? 0) * 50) : 0;
  const acosVal = safeDiv(curSpend, curSales);
  const acosScore = acosVal == null ? 0 : Math.max(0, 5 - acosVal * 5);
  const histEvidence = Math.min(15, Math.log1p(histOrders) * 5);
  const gap = ev.multiAsin;
  let opportunity = 0;
  if (
    gap?.bestCompNaturalRank != null &&
    gap.bestCompNaturalRank <= 48 &&
    (gap.ownNaturalRank == null || gap.ownNaturalRank > 48)
  )
    opportunity += 10;
  if (
    gap?.ownTrafficShare != null &&
    gap.maxCompTrafficShare != null &&
    gap.maxCompTrafficShare > (gap.ownTrafficShare ?? 0)
  )
    opportunity += 5;
  opportunity = Math.min(15, opportunity);

  let risk = 0;
  if (score.relevanceLabel === '不相关') risk += 25;
  if (curOrders === 0 && curSpend > 0) risk += Math.min(20, curSpend);
  if (acosVal != null && acosVal > 0.7) risk += 10;

  return Math.max(
    0,
    Math.min(
      100,
      semantic + orderEvidence + cvrScore + acosScore + histEvidence + opportunity - risk,
    ),
  );
};

export const assignOpsLabel = (
  score: KeywordSemanticScore,
  ev: KeywordEvidence,
  gapLabel: GapLabel | null,
  thresholds: AnalysisThresholds,
  priceUsd: number,
): OpsLabel => {
  const waste = wasteSpendThreshold(priceUsd, thresholds);
  const curOrders = ev.current?.orders ?? 0;
  const curClicks = ev.current?.clicks ?? 0;
  const curSpend = ev.current?.spend ?? 0;
  const curSales = ev.current?.sales ?? 0;
  const histOrders = ev.history?.orders ?? 0;
  const curAcos = safeDiv(curSpend, curSales);
  const curCvr = cvr(curOrders, curClicks);
  const highRel = isHighRelevance(score.relevanceLabel);
  const coreRel = score.relevanceLabel === '核心高相关';

  // 否词候选 first for semantic mismatch
  if (score.relevanceLabel === '不相关') return '否词候选';
  if (score.relevanceLabel === '低相关' && curOrders === 0 && curSpend >= waste) return '否词候选';

  // 高胜率词
  if (
    highRel &&
    curOrders >= 2 &&
    ((curAcos != null && curAcos <= 0.45) || (curCvr != null && curCvr >= 0.12))
  ) {
    return '高胜率词';
  }
  if (coreRel && curOrders >= 1 && histOrders >= 2) return '高胜率词';

  // 广告低效词
  if (curOrders === 0 && curSpend >= waste) return '广告低效词';
  if (curOrders > 0 && curAcos != null && curAcos > thresholds.highRiskAcos) return '广告低效词';
  if (
    gapLabel === '我方独投（复核）' &&
    curOrders === 0 &&
    (curSpend >= waste || curClicks >= thresholds.wasteClicks)
  ) {
    return '广告低效词';
  }

  // 新机会词
  if (highRel && gapLabel === '自然位追赶' && (curSpend < waste || curOrders > 0)) {
    return '新机会词';
  }
  if (
    highRel &&
    (ev.impressionShare?.avgShare ?? 1) < 0.15 &&
    curOrders > 0 &&
    curAcos != null &&
    curAcos <= thresholds.targetAcos
  ) {
    return '新机会词';
  }

  // 历史沉睡词
  if (histOrders >= 2 && curOrders === 0 && curClicks < thresholds.wasteClicks) {
    return '历史沉睡词';
  }

  // 品牌防守 — caller may override with brand term set; keep soft default
  if (score.category === '品牌词' && highRel) return '品牌防守词';

  if (highRel && (curClicks > 0 || histOrders > 0)) return '观察测试词';

  return '低优先级词';
};

export const pickPrimarySource = (
  sources: NonNullable<KeywordEvidence['sources']>,
  mode: 'orders' | 'problem_spend' | 'test',
) => {
  if (!sources.length) return null;
  const sorted = [...sources].sort((a, b) => {
    if (mode === 'orders') {
      const od = (b.orders ?? 0) - (a.orders ?? 0);
      if (od !== 0) return od;
      const sd = (b.sales ?? 0) - (a.sales ?? 0);
      if (sd !== 0) return sd;
      return (b.spend ?? 0) - (a.spend ?? 0);
    }
    if (mode === 'problem_spend') {
      const aZero = (a.orders ?? 0) === 0 ? 1 : 0;
      const bZero = (b.orders ?? 0) === 0 ? 1 : 0;
      if (bZero !== aZero) return bZero - aZero;
      return (b.spend ?? 0) - (a.spend ?? 0);
    }
    // test
    const od = (b.orders ?? 0) - (a.orders ?? 0);
    if (od !== 0) return od;
    const sd = (b.spend ?? 0) - (a.spend ?? 0);
    if (sd !== 0) return sd;
    return (b.clicks ?? 0) - (a.clicks ?? 0);
  });
  return sorted[0] ?? null;
};

export const formatSourceCombo = (s: NonNullable<KeywordEvidence['sources']>[number]) =>
  `[${s.channel}] ${s.campaign ?? '-'}｜${s.adGroup ?? '源报告无广告组字段'}｜${s.matchOrTarget ?? '-'}｜订单${s.orders ?? 0}｜花费${(s.spend ?? 0).toFixed(2)}`;

export const buildKeywordDecision = (
  score: KeywordSemanticScore,
  ev: KeywordEvidence,
  thresholds: AnalysisThresholds,
  priceUsd: number,
  ownBrandTerms: Set<string> = new Set(),
): KeywordDecision => {
  const gapLabel = computeGapLabel(ev);
  let opsLabel = assignOpsLabel(score, ev, gapLabel, thresholds, priceUsd);
  if (
    ownBrandTerms.has(ev.keywordKey) &&
    isHighRelevance(score.relevanceLabel) &&
    (opsLabel === '低优先级词' || opsLabel === '观察测试词')
  )
    opsLabel = '品牌防守词';

  const sources = ev.sources ?? [];
  const mode =
    opsLabel === '高胜率词'
      ? 'orders'
      : opsLabel === '广告低效词' || opsLabel === '否词候选'
        ? 'problem_spend'
        : 'test';
  const primary = sources.length ? pickPrimarySource(sources, mode) : null;
  const campaigns = new Set(sources.map((s) => s.campaign).filter(Boolean));
  const combos = sources.map(formatSourceCombo);
  const compositeScore = computeCompositeScore(score, ev);

  let executionLevel = '当前未投放/未检出';
  if (sources.length === 0) {
    executionLevel = '当前未投放/未检出';
  } else if (opsLabel === '高胜率词') {
    executionLevel = campaigns.size > 1 ? '分活动保护并独立核算' : '广告组/活动保护';
  } else if (opsLabel === '广告低效词' || opsLabel === '否词候选') {
    executionLevel =
      campaigns.size > 1 ? '仅处理问题活动/广告组，不全局否定' : '优先广告组层级处理';
  } else if (opsLabel === '新机会词') {
    executionLevel = sources.length ? '分活动对照测试，优先已有位置' : '新建小预算测试';
  }

  let suggestedNegMatch: string | undefined;
  if (opsLabel === '否词候选') {
    suggestedNegMatch =
      score.relevanceLabel === '不相关' ? '精确否定（受影响活动）' : '词组/精确否定复核';
  } else if (opsLabel === '广告低效词') {
    suggestedNegMatch = '不全局否定；仅问题位置降价/暂停或精确否定';
  }

  const priority =
    compositeScore >= 80 ? 'P0' : compositeScore >= 65 ? 'P1' : compositeScore >= 50 ? 'P2' : 'P3';

  return {
    ...ev,
    ...score,
    opsLabel,
    gapLabel,
    compositeScore,
    priority,
    primarySource: primary,
    sourceCampaignCount: campaigns.size,
    sourceComboCount: combos.length,
    allSourceCombos: combos.join('\n'),
    executionLevel,
    suggestedNegMatch,
  };
};

export const decideAsin = (input: {
  asin: string;
  mainAsin: string;
  currentOrders?: number;
  historyOrders?: number;
  currentSpend?: number;
  currentClicks?: number;
  priceUsd: number;
  thresholds: AnalysisThresholds;
  rest: Omit<AsinDecision, 'asin' | 'suggestion' | 'rationale'>;
}): AsinDecision => {
  const {
    asin,
    mainAsin,
    currentOrders = 0,
    historyOrders = 0,
    currentSpend = 0,
    currentClicks = 0,
    priceUsd,
    thresholds,
    rest,
  } = input;
  if (asin.toUpperCase() === mainAsin.toUpperCase()) {
    return { asin, suggestion: '自有ASIN，不否定', rationale: '主ASIN', ...rest };
  }
  if (currentOrders > 0 || historyOrders > 0) {
    return {
      asin,
      suggestion: '转商品投放单独管理',
      rationale: '已有当前或历史转化，不直接否定',
      ...rest,
    };
  }
  const waste = wasteSpendThreshold(priceUsd, thresholds);
  if (currentSpend >= waste || currentClicks >= thresholds.wasteClicks) {
    return {
      asin,
      suggestion: '商品否定候选',
      rationale: `无订单且达到花费/点击阈值（花费≥${waste.toFixed(2)} 或 点击≥${thresholds.wasteClicks}）`,
      ...rest,
    };
  }
  return { asin, suggestion: '观察', rationale: '数据不足，未达到明确保留或否定阈值', ...rest };
};
