import { asNumber, asRatio } from './format';
import type { AnalyzeCampaignResult, CompareBlock, MetricWindow, Thresholds } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const pick = (raw: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k];
  }
  return undefined;
};

/** "2026-08-03~2026-08-09" → { start, end } */
const splitDateRange = (range: unknown): { end: string | null; start: string | null } => {
  if (typeof range !== 'string' || !range.includes('~')) return { end: null, start: null };
  const [start, end] = range.split('~').map((s) => s.trim());
  return { end: end || null, start: start || null };
};

const pickWindow = (raw: unknown): MetricWindow | null => {
  if (!isRecord(raw)) return null;
  const fromRange = splitDateRange(raw.date_range);
  const start = typeof raw.start === 'string' ? raw.start : fromRange.start;
  const end = typeof raw.end === 'string' ? raw.end : fromRange.end;
  return {
    acos: asRatio(pick(raw, 'acos', 'ACoS', 'Acos')),
    clicks: asNumber(pick(raw, 'clicks', 'Clicks')),
    cpc: asNumber(pick(raw, 'cpc', 'CPC', 'Cpc')),
    cpo: asNumber(pick(raw, 'cpo', 'CPO', 'Cpo')),
    cvr: asRatio(pick(raw, 'cvr', 'CVR', 'Cvr')),
    end,
    orders: asNumber(pick(raw, 'orders', 'Orders')),
    sales: asNumber(pick(raw, 'sales', 'Sales')),
    spend: asNumber(pick(raw, 'spend', 'cost', 'Cost')),
    start,
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
    acos_high: asRatio(pick(raw, 'acos_high')),
    acos_low: asRatio(pick(raw, 'acos_low')),
    acos_ultra: asRatio(pick(raw, 'acos_ultra', 'acos_super_high')),
    bid_up_cap: asNumber(pick(raw, 'bid_up_cap')),
    bid_zero_order_up_cap: asNumber(pick(raw, 'bid_zero_order_up_cap')),
    cpo_double: asNumber(pick(raw, 'cpo_double', 'double_cpo')),
    cpo_high_click: asNumber(pick(raw, 'cpo_high_click')),
    cpo_low_click: asNumber(pick(raw, 'cpo_low_click')),
    cvr_high: asRatio(pick(raw, 'cvr_high')),
    cvr_low: asRatio(pick(raw, 'cvr_low')),
  };
};

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
            : typeof item.search_term === 'string'
              ? item.search_term
              : null,
    }))
    .filter((h) => h.query);
};

const pickNegatives = (raw: unknown) => {
  // MCP may return [] (no hits) or { keyword, asin }
  if (Array.isArray(raw)) {
    const keyword = mapHits(raw.filter((item) => isRecord(item) && item.kind !== 'asin'));
    const asin = mapHits(
      raw.filter(
        (item) =>
          isRecord(item) &&
          (item.kind === 'asin' ||
            (typeof item.query === 'string' && /^B0[A-Z0-9]{8}$/i.test(item.query))),
      ),
    );
    return { asin, keyword };
  }
  if (!isRecord(raw)) return null;
  return {
    asin: mapHits(raw.asin ?? raw.asins),
    keyword: mapHits(raw.keyword ?? raw.keywords ?? raw.word ?? raw.words),
  };
};

const parseJsonIfString = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Unwrap MCP tool payload: prefer `result`, else root if it looks like analyze output. */
export const unwrapAnalyzePayload = (payload: unknown): unknown => {
  if (!isRecord(payload)) return payload;

  // MCP streamable HTTP: { content: [{ type: 'text', text: '{...}' }], isError?: boolean }
  if (Array.isArray(payload.content)) {
    const text = payload.content
      .filter(isRecord)
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('');
    if (text) return unwrapAnalyzePayload(parseJsonIfString(text));
  }

  if (isRecord(payload.result)) {
    // analyze_campaign wraps metrics under result.result; bare result is fine too
    const inner = payload.result;
    if (
      isRecord(inner) &&
      (inner.compare_7d !== undefined ||
        inner.compare_14d !== undefined ||
        inner.trend !== undefined ||
        inner.thresholds !== undefined)
    ) {
      return inner;
    }
    return unwrapAnalyzePayload(inner);
  }
  if (isRecord(payload.data) && isRecord((payload.data as any).result)) {
    return unwrapAnalyzePayload((payload.data as any).result);
  }
  // content string from processToolCallResult
  if (typeof payload.content === 'string') {
    return unwrapAnalyzePayload(parseJsonIfString(payload.content));
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
