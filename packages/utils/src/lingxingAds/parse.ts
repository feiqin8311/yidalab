import { asNumber } from './format';
import type { AnalyzeCampaignResult, CompareBlock, MetricWindow, Thresholds } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const pickWindow = (raw: unknown): MetricWindow | null => {
  if (!isRecord(raw)) return null;
  return {
    acos: asNumber(raw.acos),
    clicks: asNumber(raw.clicks),
    cpc: asNumber(raw.cpc),
    cpo: asNumber(raw.cpo),
    cvr: asNumber(raw.cvr),
    end: typeof raw.end === 'string' ? raw.end : null,
    orders: asNumber(raw.orders),
    sales: asNumber(raw.sales),
    spend: asNumber(raw.spend),
    start: typeof raw.start === 'string' ? raw.start : null,
  };
};

const pickCompare = (raw: unknown): CompareBlock | null => {
  if (!isRecord(raw)) return null;
  return {
    current: pickWindow(raw.current ?? raw.near ?? raw.recent),
    previous: pickWindow(raw.previous ?? raw.prev ?? raw.prior),
  };
};

const pickThresholds = (raw: unknown): Thresholds | null => {
  if (!isRecord(raw)) return null;
  return {
    acos_high: asNumber(raw.acos_high),
    acos_low: asNumber(raw.acos_low),
    acos_ultra: asNumber(raw.acos_ultra),
    bid_up_cap: asNumber(raw.bid_up_cap),
    bid_zero_order_up_cap: asNumber(raw.bid_zero_order_up_cap),
    cpo_double: asNumber(raw.cpo_double),
    cpo_high_click: asNumber(raw.cpo_high_click),
    cpo_low_click: asNumber(raw.cpo_low_click),
    cvr_high: asNumber(raw.cvr_high),
    cvr_low: asNumber(raw.cvr_low),
  };
};

const pickNegatives = (raw: unknown) => {
  if (!isRecord(raw)) return null;
  const mapHits = (list: unknown) => {
    if (!Array.isArray(list)) return [];
    return list
      .filter(isRecord)
      .map((item) => ({
        clicks: asNumber(item.clicks),
        kind: typeof item.kind === 'string' ? item.kind : null,
        query:
          typeof item.query === 'string'
            ? item.query
            : typeof item.keyword === 'string'
              ? item.keyword
              : null,
      }))
      .filter((h) => h.query);
  };
  return {
    asin: mapHits(raw.asin ?? raw.asins),
    keyword: mapHits(raw.keyword ?? raw.keywords ?? raw.word ?? raw.words),
  };
};

/** Unwrap MCP tool payload: prefer `result`, else root if it looks like analyze output. */
export const unwrapAnalyzePayload = (payload: unknown): unknown => {
  if (!isRecord(payload)) return payload;
  if (isRecord(payload.result)) return payload.result;
  if (isRecord(payload.data) && isRecord((payload.data as any).result)) {
    return (payload.data as any).result;
  }
  // content string from processToolCallResult
  if (typeof payload.content === 'string') {
    try {
      const parsed = JSON.parse(payload.content);
      return unwrapAnalyzePayload(parsed);
    } catch {
      // fall through
    }
  }
  // processed MCP state may nest content blocks
  if (isRecord(payload.state)) return unwrapAnalyzePayload(payload.state);
  return payload;
};

export const parseAnalyzeCampaignResult = (payload: unknown): AnalyzeCampaignResult => {
  const root = unwrapAnalyzePayload(payload);
  if (!isRecord(root)) {
    throw new Error('LINGXING_INVALID_PAYLOAD');
  }

  const hasCore =
    root.compare_7d !== undefined ||
    root.compare_14d !== undefined ||
    root.trend !== undefined ||
    root.thresholds !== undefined;

  if (!hasCore) {
    throw new Error('LINGXING_INCOMPLETE_PAYLOAD');
  }

  const trendLabel =
    isRecord(root.trend) && typeof root.trend.label === 'string'
      ? root.trend.label
      : typeof root.trend === 'string'
        ? root.trend
        : null;

  return {
    best_week: pickWindow(root.best_week),
    compare_14d: pickCompare(root.compare_14d),
    compare_30d: pickCompare(root.compare_30d),
    compare_7d: pickCompare(root.compare_7d),
    negative_rules_ad: pickNegatives(root.negative_rules_ad),
    negative_rules_ad_groups: pickNegatives(root.negative_rules_ad_groups),
    negative_rules_target: pickNegatives(root.negative_rules_target),
    recommended_settings: isRecord(root.recommended_settings)
      ? {
          Bid: asNumber(root.recommended_settings.Bid ?? root.recommended_settings.bid),
          bid: asNumber(root.recommended_settings.bid ?? root.recommended_settings.Bid),
        }
      : null,
    sku_14d_all: pickWindow(root.sku_14d_all),
    sku_30d_all: pickWindow(root.sku_30d_all),
    thresholds: pickThresholds(root.thresholds),
    trend: { label: trendLabel },
  };
};
