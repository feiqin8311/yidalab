import {
  type AnalysisThresholds,
  type AsinDecision,
  buildKeywordDecision,
  type DailyTrendRow,
  type DataSourceNote,
  decideAsin,
  isExactAsin,
  type KeywordDecision,
  type KeywordEvidence,
  type KeywordSemanticScore,
  type MaterializedViews,
  normalizeKeywordKey,
  type ProductSemanticProfile,
  type RunSummary,
  type SpTargetingRow,
} from '@lobechat/utils';

export const materializeViews = (input: {
  keywords: Map<string, KeywordEvidence>;
  scores: Map<string, KeywordSemanticScore>;
  profile: ProductSemanticProfile;
  thresholds: AnalysisThresholds;
  priceUsd: number;
  mainAsin: string;
  dailyTrend: DailyTrendRow[];
  spTargeting: SpTargetingRow[];
  dataSourceNotes: DataSourceNote[];
  spOrderAudit?: { totalOrders: number; naturalOrders: number; asinOrders: number };
}): { views: MaterializedViews; summary: RunSummary; decisions: KeywordDecision[] } => {
  const ownBrand = new Set((input.profile.ownBrandTerms ?? []).map((t) => normalizeKeywordKey(t)));

  const decisions: KeywordDecision[] = [];
  const asinMap = new Map<string, KeywordEvidence>();

  for (const [key, ev] of input.keywords) {
    if (ev.isExactAsin || isExactAsin(ev.keyword)) {
      asinMap.set(key.toUpperCase(), ev);
      continue;
    }
    const score = input.scores.get(key) ?? {
      keyword: ev.keyword,
      keywordKey: key,
      category: '类目词' as const,
      relevanceScore: 50,
      relevanceLabel: '中相关' as const,
      rationale: '缺少语义评分',
    };
    decisions.push(buildKeywordDecision(score, ev, input.thresholds, input.priceUsd, ownBrand));
  }

  const high_win = decisions
    .filter((d) => d.opsLabel === '高胜率词')
    .sort((a, b) => (b.current?.orders ?? 0) - (a.current?.orders ?? 0));
  const new_opportunity = decisions
    .filter((d) => d.opsLabel === '新机会词')
    .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
  const low_efficiency = decisions
    .filter((d) => d.opsLabel === '广告低效词' || d.opsLabel === '否词候选')
    .sort((a, b) => (b.current?.spend ?? 0) - (a.current?.spend ?? 0));
  const history_sleep = decisions
    .filter((d) => d.opsLabel === '历史沉睡词')
    .sort((a, b) => (b.history?.orders ?? 0) - (a.history?.orders ?? 0));
  const competitor_gap = decisions
    .filter((d) => d.gapLabel && d.gapLabel !== '差距有限/观察')
    .sort((a, b) => (b.multiAsin?.naturalRankGap ?? 0) - (a.multiAsin?.naturalRankGap ?? 0));
  const brand_ads = decisions
    .filter((d) => (d.sb?.clicks ?? 0) > 0 || (d.sb?.spend ?? 0) > 0)
    .sort((a, b) => (b.sb?.clickOrders ?? 0) - (a.sb?.clickOrders ?? 0));

  // ASIN decisions from exact-asin keyword evidence + targeting ASIN rows
  const asinAgg = new Map<
    string,
    {
      currentSpend: number;
      currentSales: number;
      currentOrders: number;
      currentClicks: number;
      historyClicks: number;
      historySpend: number;
      historyOrders: number;
      targetingImpressions: number;
      targetingClicks: number;
      targetingSpend: number;
      targetingOrders: number;
      spSearchImpressions: number;
      spSearchClicks: number;
      spSearchSpend: number;
      spSearchOrders: number;
      sbSearchClicks: number;
      sbSearchSpend: number;
      sbClickOrders: number;
    }
  >();

  const bumpAsin = (asin: string, patch: Partial<ReturnType<typeof asinAgg.get> & object>) => {
    const cur = asinAgg.get(asin) ?? {
      currentSpend: 0,
      currentSales: 0,
      currentOrders: 0,
      currentClicks: 0,
      historyClicks: 0,
      historySpend: 0,
      historyOrders: 0,
      targetingImpressions: 0,
      targetingClicks: 0,
      targetingSpend: 0,
      targetingOrders: 0,
      spSearchImpressions: 0,
      spSearchClicks: 0,
      spSearchSpend: 0,
      spSearchOrders: 0,
      sbSearchClicks: 0,
      sbSearchSpend: 0,
      sbClickOrders: 0,
    };
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'number') (cur as any)[k] = ((cur as any)[k] ?? 0) + v;
    }
    asinAgg.set(asin, cur);
  };

  for (const [asinKey, ev] of asinMap) {
    const asin = asinKey.toUpperCase();
    bumpAsin(asin, {
      currentSpend: ev.current?.spend ?? 0,
      currentSales: ev.current?.sales ?? 0,
      currentOrders: ev.current?.orders ?? 0,
      currentClicks: ev.current?.clicks ?? 0,
      historyClicks: ev.history?.clicks ?? 0,
      historySpend: ev.history?.spend ?? 0,
      historyOrders: ev.history?.orders ?? 0,
      spSearchImpressions: ev.sp?.impressions ?? 0,
      spSearchClicks: ev.sp?.clicks ?? 0,
      spSearchSpend: ev.sp?.spend ?? 0,
      spSearchOrders: ev.sp?.orders ?? 0,
      sbSearchClicks: ev.sb?.clicks ?? 0,
      sbSearchSpend: ev.sb?.spend ?? 0,
      sbClickOrders: ev.sb?.clickOrders ?? 0,
    });
  }

  for (const t of input.spTargeting) {
    if (!t.asin) continue;
    bumpAsin(t.asin.toUpperCase(), {
      targetingImpressions: t.impressions ?? 0,
      targetingClicks: t.clicks ?? 0,
      targetingSpend: t.spend ?? 0,
      targetingOrders: t.orders ?? 0,
      currentSpend: t.spend ?? 0,
      currentSales: t.sales ?? 0,
      currentOrders: t.orders ?? 0,
      currentClicks: t.clicks ?? 0,
    });
  }

  const asin_negative: AsinDecision[] = [...asinAgg.entries()].map(([asin, m]) =>
    decideAsin({
      asin,
      mainAsin: input.mainAsin,
      currentOrders: m.currentOrders,
      historyOrders: m.historyOrders,
      currentSpend: m.currentSpend,
      currentClicks: m.currentClicks,
      priceUsd: input.priceUsd,
      thresholds: input.thresholds,
      rest: {
        currentSpend: m.currentSpend,
        currentSales: m.currentSales,
        currentOrders: m.currentOrders,
        currentAcos: m.currentSales > 0 ? m.currentSpend / m.currentSales : null,
        targetingImpressions: m.targetingImpressions,
        targetingClicks: m.targetingClicks,
        targetingSpend: m.targetingSpend,
        targetingOrders: m.targetingOrders,
        spSearchImpressions: m.spSearchImpressions,
        spSearchClicks: m.spSearchClicks,
        spSearchSpend: m.spSearchSpend,
        spSearchOrders: m.spSearchOrders,
        sbSearchClicks: m.sbSearchClicks,
        sbSearchSpend: m.sbSearchSpend,
        sbClickOrders: m.sbClickOrders,
        historyClicks: m.historyClicks,
        historySpend: m.historySpend,
        historyOrders: m.historyOrders,
      },
    }),
  );

  const highRel = decisions.filter(
    (d) => d.relevanceLabel === '高相关' || d.relevanceLabel === '核心高相关',
  );
  const spNaturalOrders = decisions.reduce((s, d) => s + (d.sp?.orders ?? 0), 0);
  const spSpend = decisions.reduce((s, d) => s + (d.sp?.spend ?? 0), 0);
  const spSales = decisions.reduce((s, d) => s + (d.sp?.sales ?? 0), 0);
  const sbClickOrders = decisions.reduce((s, d) => s + (d.sb?.clickOrders ?? 0), 0);
  const sbSpend = decisions.reduce((s, d) => s + (d.sb?.spend ?? 0), 0);
  const sbSales = decisions.reduce((s, d) => s + (d.sb?.clickSales ?? 0), 0);

  const summary: RunSummary = {
    naturalKeywordCount: decisions.length,
    highRelevanceCount: highRel.length,
    highWinCount: high_win.length,
    newOpportunityCount: new_opportunity.length,
    lowEfficiencyAndNegativeCount: low_efficiency.length,
    spNaturalOrders,
    spAcos: spSales > 0 ? spSpend / spSales : null,
    sbClickOrders,
    sbAcos: sbSales > 0 ? sbSpend / sbSales : null,
    asinNegativeCandidateCount: asin_negative.filter((a) => a.suggestion === '商品否定候选').length,
    limitedMode: input.dataSourceNotes.some((n) => n.missing),
    missingSources: input.dataSourceNotes.filter((n) => n.missing).map((n) => n.role as any),
  };

  const scoring_rules = [
    { 参数: '目标ACoS', 当前值: input.thresholds.targetAcos, 用途: '高胜率及效率判断的参考阈值' },
    { 参数: '高风险ACoS', 当前值: input.thresholds.highRiskAcos, 用途: '超过该值进入低效复核' },
    {
      参数: '无单花费阈值',
      当前值: input.priceUsd * input.thresholds.wasteSpendRatioToPrice,
      用途: '售价×wasteSpendRatioToPrice',
    },
    { 参数: '无单点击阈值', 当前值: input.thresholds.wasteClicks, 用途: '无单高点击复核' },
    { 参数: '高相关分数线', 当前值: input.thresholds.highRelevanceScore, 用途: '语义高相关' },
    { 参数: '核心相关分数线', 当前值: input.thresholds.coreRelevanceScore, 用途: '语义核心高相关' },
    {
      参数: 'SP订单对账',
      当前值: input.spOrderAudit
        ? `${input.spOrderAudit.totalOrders}=${input.spOrderAudit.naturalOrders}+${input.spOrderAudit.asinOrders}`
        : 'N/A',
      用途: '总订单=自然词订单+ASIN搜索词订单',
    },
  ];

  const views: MaterializedViews = {
    overview: {
      title: `${input.profile.title ?? input.profile.coreCategory}｜老品关键词全盘分析`,
      mainAsin: input.mainAsin,
      summary,
      productProfile: input.profile,
    },
    high_win,
    new_opportunity,
    low_efficiency,
    history_sleep,
    competitor_gap,
    asin_negative,
    full_lexicon: decisions.sort((a, b) => b.compositeScore - a.compositeScore),
    brand_ads,
    sp_targeting: input.spTargeting,
    daily_trend: input.dailyTrend,
    scoring_rules,
    data_sources: input.dataSourceNotes,
  };

  return { views, summary, decisions };
};

export const toResultRowRecords = (
  runId: string,
  views: MaterializedViews,
): {
  viewId: string;
  rowKey: string;
  searchText?: string;
  sortOrders?: number;
  sortSpend?: number;
  sortScore?: number;
  sortRank?: number;
  data: Record<string, unknown>;
}[] => {
  const rows: {
    viewId: string;
    rowKey: string;
    searchText?: string;
    sortOrders?: number;
    sortSpend?: number;
    sortScore?: number;
    sortRank?: number;
    data: Record<string, unknown>;
  }[] = [];

  const pushKw = (viewId: string, list: KeywordDecision[]) => {
    list.forEach((d, i) => {
      rows.push({
        viewId,
        rowKey: d.keywordKey || `row_${i}`,
        searchText: d.keyword,
        sortOrders: d.current?.orders ?? 0,
        sortSpend: d.current?.spend ?? 0,
        sortScore: d.compositeScore ?? 0,
        sortRank: d.multiAsin?.ownNaturalRank ?? undefined,
        data: d as unknown as Record<string, unknown>,
      });
    });
  };

  pushKw('high_win', views.high_win);
  pushKw('new_opportunity', views.new_opportunity);
  pushKw('low_efficiency', views.low_efficiency);
  pushKw('history_sleep', views.history_sleep);
  pushKw('competitor_gap', views.competitor_gap);
  pushKw('full_lexicon', views.full_lexicon);
  pushKw('brand_ads', views.brand_ads);

  views.asin_negative.forEach((a, i) => {
    rows.push({
      viewId: 'asin_negative',
      rowKey: a.asin || `asin_${i}`,
      searchText: a.asin,
      sortOrders: a.currentOrders ?? 0,
      sortSpend: a.currentSpend ?? 0,
      data: a as unknown as Record<string, unknown>,
    });
  });

  views.sp_targeting.forEach((t, i) => {
    rows.push({
      viewId: 'sp_targeting',
      rowKey: `${t.targetType}:${t.target}:${i}`,
      searchText: t.target,
      sortOrders: t.orders ?? 0,
      sortSpend: t.spend ?? 0,
      data: t as unknown as Record<string, unknown>,
    });
  });

  views.daily_trend.forEach((d) => {
    rows.push({
      viewId: 'daily_trend',
      rowKey: d.date,
      searchText: d.date,
      sortOrders: d.totalClickOrders ?? 0,
      sortSpend: d.totalSpend ?? 0,
      data: d as unknown as Record<string, unknown>,
    });
  });

  views.scoring_rules.forEach((r, i) => {
    rows.push({
      viewId: 'scoring_rules',
      rowKey: `rule_${i}`,
      searchText: String((r as any).参数 ?? ''),
      data: r,
    });
  });

  views.data_sources.forEach((r, i) => {
    rows.push({
      viewId: 'data_sources',
      rowKey: `src_${i}_${r.role}`,
      searchText: r.file,
      data: r as unknown as Record<string, unknown>,
    });
  });

  rows.push({
    viewId: 'overview',
    rowKey: 'overview',
    searchText: 'overview',
    data: views.overview,
  });

  return rows;
};
