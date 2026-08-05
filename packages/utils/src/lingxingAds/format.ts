/** Display helpers — never invent zeros for missing metrics. */

export const MISSING = '数据缺失';

export const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export const formatPercent = (value: unknown): string => {
  const n = asNumber(value);
  if (n === null) return MISSING;
  // MCP thresholds/acos/cvr are 0~1 decimals
  return `${(n * 100).toFixed(2)}%`;
};

export const formatMoney = (value: unknown, digits = 2): string => {
  const n = asNumber(value);
  if (n === null) return MISSING;
  return `$${n.toFixed(digits)}`;
};

/** Local metric integer/decimal display — not the public `formatNumber` from `@lobechat/utils`. */
export const formatMetricNumber = (value: unknown, digits = 0): string => {
  const n = asNumber(value);
  if (n === null) return MISSING;
  return digits === 0 ? String(Math.round(n)) : n.toFixed(digits);
};

export const formatRange = (start?: string | null, end?: string | null): string => {
  if (!start && !end) return MISSING;
  if (start && end) return `${start}~${end}`;
  return start || end || MISSING;
};

export type MetricWindowLike = {
  acos?: number | null;
  cpc?: number | null;
  cpo?: number | null;
  cvr?: number | null;
  end?: string | null;
  orders?: number | null;
  start?: string | null;
};

export const formatWindowLine = (label: string, w?: MetricWindowLike | null): string => {
  if (!w) return `- ${label}：${MISSING}`;
  const range = formatRange(w.start, w.end);
  return `- ${label}（${range}）：CPC ${formatMoney(w.cpc)}，ACoS ${formatPercent(w.acos)}，CVR ${formatPercent(w.cvr)}，CPO ${formatMoney(w.cpo)}${
    w.orders !== undefined && w.orders !== null ? `，Orders ${formatMetricNumber(w.orders)}` : ''
  }`;
};
