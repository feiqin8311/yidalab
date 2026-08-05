/** MCP analyze_campaign result + V7 structured report types. */

export type TrendLabel = '持续变差' | '持续变好' | '波动较大';

export type MetricWindow = {
  end?: string | null;
  start?: string | null;
  acos?: number | null;
  cpc?: number | null;
  cpo?: number | null;
  cvr?: number | null;
  orders?: number | null;
  clicks?: number | null;
  spend?: number | null;
  sales?: number | null;
};

export type CompareBlock = {
  current?: MetricWindow | null;
  previous?: MetricWindow | null;
};

export type Thresholds = {
  acos_high?: number | null;
  acos_low?: number | null;
  acos_ultra?: number | null;
  bid_up_cap?: number | null;
  bid_zero_order_up_cap?: number | null;
  cpo_double?: number | null;
  cpo_high_click?: number | null;
  cpo_low_click?: number | null;
  cvr_high?: number | null;
  cvr_low?: number | null;
};

export type NegativeHit = {
  clicks?: number | null;
  kind?: string | null;
  query?: string | null;
};

export type NegativeRules = {
  asin?: NegativeHit[] | null;
  keyword?: NegativeHit[] | null;
};

export type BestWeek = {
  end?: string | null;
  start?: string | null;
  acos?: number | null;
  cpc?: number | null;
  cpo?: number | null;
  cvr?: number | null;
  orders?: number | null;
};

export type RecommendedSettings = {
  Bid?: number | null;
  bid?: number | null;
};

export type AnalyzeCampaignResult = {
  best_week?: BestWeek | null;
  compare_14d?: CompareBlock | null;
  compare_30d?: CompareBlock | null;
  compare_7d?: CompareBlock | null;
  negative_rules_ad?: NegativeRules | null;
  negative_rules_ad_groups?: NegativeRules | null;
  negative_rules_target?: NegativeRules | null;
  recommended_settings?: RecommendedSettings | null;
  sku_14d_all?: MetricWindow | null;
  sku_30d_all?: MetricWindow | null;
  thresholds?: Thresholds | null;
  trend?: { label?: string | null } | null;
};

export type RuleHit = '当前命中' | '当前不满足';

export type BidRuleLine = {
  action: string;
  hit: RuleHit;
  title: string;
};

export type NegativeSection = {
  asinHits: string[];
  keywordHits: string[];
  noneLabel: string;
};

export type AnalysisSections = {
  baseData: {
    bestWeek?: string | null;
    compare14d: string[];
    compare30d: string[];
    compare7d: string[];
    sku14d: string | null;
    sku30d: string | null;
    thresholds: string[];
  };
  bidWithOrders: {
    current: string;
    lines: BidRuleLine[];
    volatilityNote?: string | null;
  };
  bidZeroOrders: {
    applicable: boolean;
    lines: BidRuleLine[];
    note?: string | null;
  };
  conclusion: {
    detail: string;
    label: TrendLabel;
  };
  negativeAd: NegativeSection;
  negativeAdGroups: NegativeSection;
  negativeTarget: NegativeSection;
  restore: {
    applicable: boolean;
    lines: string[];
  };
};

export type LingxingAnalysisOutput = {
  analysis: AnalysisSections;
  markdown: string;
  source: {
    generatedAt: string;
    identifier: string;
    toolName: string;
  };
};
