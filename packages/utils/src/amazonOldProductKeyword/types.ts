/** Amazon old-product keyword panorama diagnosis — shared domain types. */

export const FUNCTION_ID = 'amazon-old-product-keyword-analysis' as const;

export const VIEW_IDS = [
  'overview',
  'high_win',
  'new_opportunity',
  'low_efficiency',
  'history_sleep',
  'competitor_gap',
  'asin_negative',
  'full_lexicon',
  'brand_ads',
  'sp_targeting',
  'daily_trend',
  'scoring_rules',
  'data_sources',
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_SHEET_NAMES: Record<ViewId, string> = {
  overview: '总览',
  high_win: '高胜率词',
  new_opportunity: '新机会词',
  low_efficiency: '低效与否词',
  history_sleep: '历史沉睡词',
  competitor_gap: '竞品差距',
  asin_negative: 'ASIN否词建议',
  full_lexicon: '全量词库',
  brand_ads: '品牌推广表现',
  sp_targeting: 'SP投放对象',
  daily_trend: '每日趋势',
  scoring_rules: '评分与分类规则',
  data_sources: '数据源说明',
};

export const DATA_SOURCE_ROLES = [
  'product_html',
  'historical_terms',
  'sp_search_terms_daily',
  'sp_targeting',
  'sp_impression_share',
  'sb_search_terms_daily',
  'multi_asin',
] as const;

export type DataSourceRole = (typeof DATA_SOURCE_ROLES)[number];

export const KEYWORD_CATEGORIES = [
  '核心词',
  '类目词',
  '品牌词',
  '产品属性词',
  '功能卖点词',
  '适用对象词',
  '使用用途词',
  '使用场景词',
  '问题需求词',
  '礼赠与节日词',
  '主题风格词',
  '组合套装词',
] as const;

export type KeywordCategory = (typeof KEYWORD_CATEGORIES)[number];

export const RELEVANCE_LABELS = ['核心高相关', '高相关', '中相关', '低相关', '不相关'] as const;

export type RelevanceLabel = (typeof RELEVANCE_LABELS)[number];

export const OPS_LABELS = [
  '高胜率词',
  '新机会词',
  '广告低效词',
  '否词候选',
  '历史沉睡词',
  '品牌防守词',
  '观察测试词',
  '低优先级词',
] as const;

export type OpsLabel = (typeof OPS_LABELS)[number];

export const GAP_LABELS = [
  '自然位追赶',
  '首屏内落后',
  '广告竞争缺口',
  '我方独投（复核）',
  '自然已强/广告防守复核',
  '自然领先',
  '自然覆盖弱',
  '差距有限/观察',
] as const;

export type GapLabel = (typeof GAP_LABELS)[number];

export const RUN_STATUSES = [
  'draft',
  'auditing',
  'queued',
  'running',
  'exporting',
  'succeeded',
  'failed',
  'canceled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STAGES = [
  'draft',
  'audit_inputs',
  'parse_sources',
  'aggregate',
  'ai_product_profile',
  'ai_keyword_batches',
  'ops_labels',
  'materialize_views',
  'persist',
  'export',
  'done',
] as const;

export type RunStage = (typeof RUN_STAGES)[number];

export type AnalysisThresholds = {
  targetAcos: number;
  highRiskAcos: number;
  wasteSpendRatioToPrice: number;
  wasteClicks: number;
  highRelevanceScore: number;
  coreRelevanceScore: number;
};

export const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  targetAcos: 0.35,
  highRiskAcos: 0.7,
  wasteSpendRatioToPrice: 0.5,
  wasteClicks: 8,
  highRelevanceScore: 70,
  coreRelevanceScore: 85,
};

export type ModelSnapshot = {
  provider: string;
  model: string;
};

export type DataSourceFileRef = {
  role: DataSourceRole;
  fileName: string;
  /** Server-owned S3 key under the run path — never trust client-supplied free paths. */
  s3Key: string;
  size: number;
  contentType?: string;
  sheetNames?: string[];
  dateRange?: { start?: string; end?: string };
  rawRowCount?: number;
  includedRowCount?: number;
  missing?: boolean;
  notes?: string[];
};

export type SourceManifest = Partial<Record<DataSourceRole, DataSourceFileRef>>;

export type RunProgress = {
  stage: RunStage;
  stageLabel?: string;
  percent: number;
  batchIndex?: number;
  batchTotal?: number;
  keywordTotal?: number;
  keywordDone?: number;
  message?: string;
};

export type RunError = {
  code: string;
  message: string;
  stage?: RunStage;
  batchIndex?: number;
  retryable?: boolean;
  details?: unknown;
};

export type RunSummary = {
  naturalKeywordCount?: number;
  highRelevanceCount?: number;
  highWinCount?: number;
  newOpportunityCount?: number;
  lowEfficiencyAndNegativeCount?: number;
  spNaturalOrders?: number;
  spAcos?: number | null;
  sbClickOrders?: number;
  sbAcos?: number | null;
  asinNegativeCandidateCount?: number;
  missingSources?: DataSourceRole[];
  limitedMode?: boolean;
  reportWindow?: { start?: string; end?: string };
};

export type ExportInfo = {
  status: 'idle' | 'pending' | 'running' | 'succeeded' | 'failed';
  s3Key?: string;
  fileName?: string;
  size?: number;
  error?: string;
  generatedAt?: string;
};

export type ProductSemanticProfile = {
  mainAsin: string;
  brand?: string;
  coreCategory: string;
  title?: string;
  targetUsers?: string[];
  ageRange?: string;
  functions?: string[];
  differentiators?: string[];
  materials?: string[];
  sizes?: string[];
  colors?: string[];
  packInfo?: string;
  useCases?: string[];
  scenes?: string[];
  risksOrUnfit?: string[];
  ownBrandTerms?: string[];
  competitorBrandTerms?: string[];
  notes?: string;
};

export type KeywordSemanticScore = {
  keyword: string;
  keywordKey: string;
  category: KeywordCategory;
  relevanceScore: number;
  relevanceLabel: RelevanceLabel;
  rationale: string;
};

export type ChannelMetrics = {
  impressions?: number;
  clicks?: number;
  spend?: number;
  sales?: number;
  orders?: number;
  cvr?: number | null;
  acos?: number | null;
};

export type AdSourceLocation = {
  channel: string;
  campaign?: string;
  adGroup?: string;
  matchOrTarget?: string;
  orders?: number;
  spend?: number;
  sales?: number;
  clicks?: number;
};

export type KeywordEvidence = {
  keyword: string;
  keywordKey: string;
  isExactAsin: boolean;
  history?: ChannelMetrics;
  sp?: ChannelMetrics & {
    last30?: ChannelMetrics;
    prev30?: ChannelMetrics;
    trend?: number | null;
    trendLabel?: string;
  };
  sb?: ChannelMetrics & {
    clickOrders?: number;
    clickSales?: number;
    assistOrders?: number;
    assistSales?: number;
    sbv?: ChannelMetrics;
    sbh?: ChannelMetrics;
    other?: ChannelMetrics;
  };
  current?: ChannelMetrics;
  impressionShare?: {
    avgShare?: number | null;
    latestShare?: number | null;
    avgRank?: number | null;
    latestRank?: number | null;
  };
  multiAsin?: {
    ownNaturalRank?: number | null;
    bestCompNaturalRank?: number | null;
    bestCompNaturalAsin?: string | null;
    compNaturalTop48Count?: number;
    compNaturalTop20Count?: number;
    ownSpRank?: number | null;
    ownPaidPresent?: boolean;
    compPaidCount?: number;
    ownTrafficShare?: number | null;
    maxCompTrafficShare?: number | null;
    maxCompTrafficAsin?: string | null;
    naturalRankGap?: number | null;
  };
  sources?: AdSourceLocation[];
  dataSourceTags?: string[];
};

export type KeywordDecision = KeywordEvidence &
  KeywordSemanticScore & {
    opsLabel: OpsLabel;
    gapLabel?: GapLabel | null;
    compositeScore: number;
    priority?: string;
    suggestedAction?: string;
    primarySource?: AdSourceLocation | null;
    sourceCampaignCount?: number;
    sourceComboCount?: number;
    allSourceCombos?: string;
    executionLevel?: string;
    suggestedNegMatch?: string;
  };

export type AsinDecision = {
  asin: string;
  suggestion: string;
  rationale: string;
  currentSpend?: number;
  currentSales?: number;
  currentOrders?: number;
  currentAcos?: number | null;
  targetingImpressions?: number;
  targetingClicks?: number;
  targetingSpend?: number;
  targetingOrders?: number;
  spSearchImpressions?: number;
  spSearchClicks?: number;
  spSearchSpend?: number;
  spSearchOrders?: number;
  sbSearchClicks?: number;
  sbSearchSpend?: number;
  sbClickOrders?: number;
  historyClicks?: number;
  historySpend?: number;
  historyOrders?: number;
};

export type DailyTrendRow = {
  date: string;
  spImpressions?: number;
  spClicks?: number;
  spSpend?: number;
  spSales?: number;
  spOrders?: number;
  sbImpressions?: number;
  sbClicks?: number;
  sbSpend?: number;
  sbClickSales?: number;
  sbClickOrders?: number;
  sbTotalOrders?: number;
  totalSpend?: number;
  totalClickOrders?: number;
};

export type SpTargetingRow = {
  targetType: string;
  target: string;
  matchType?: string;
  asin?: string | null;
  impressions?: number;
  clicks?: number;
  spend?: number;
  sales?: number;
  orders?: number;
  cvr?: number | null;
  acos?: number | null;
  suggestion?: string;
  rationale?: string;
};

export type DataSourceNote = {
  file: string;
  role: DataSourceRole | string;
  rangeOrGranularity?: string;
  usage?: string;
  excluded?: string;
  quality?: string;
  notes?: string;
  missing?: boolean;
};

export type MaterializedViews = {
  overview: Record<string, unknown>;
  high_win: KeywordDecision[];
  new_opportunity: KeywordDecision[];
  low_efficiency: KeywordDecision[];
  history_sleep: KeywordDecision[];
  competitor_gap: KeywordDecision[];
  asin_negative: AsinDecision[];
  full_lexicon: KeywordDecision[];
  brand_ads: KeywordDecision[];
  sp_targeting: SpTargetingRow[];
  daily_trend: DailyTrendRow[];
  scoring_rules: Record<string, unknown>[];
  data_sources: DataSourceNote[];
};

export type CreateRunDraftInput = {
  workspaceId: string;
  mainAsin: string;
  categoryName: string;
  priceUsd: number;
  marketplace?: 'US';
  model: ModelSnapshot;
  thresholds?: Partial<AnalysisThresholds>;
};
