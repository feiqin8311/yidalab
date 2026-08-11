/** Display helpers — never invent zeros for missing metrics. */

export const MISSING = '数据缺失';

export const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    // "$1.33" / "52.47%" / "1,234.5" — strip currency, commas, trailing %
    const cleaned = s.replaceAll(/[$,\s]/g, '').replace(/%$/, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** MCP may send ACoS/CVR as 0~1 decimals or as "52.47%" / 52.47. Normalize to 0~1. */
export const asRatio = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (s.endsWith('%')) {
      const n = asNumber(s);
      return n === null ? null : n / 100;
    }
  }
  const n = asNumber(value);
  if (n === null) return null;
  // Heuristic: values > 1 are percent points (e.g. 52.47), not ratios
  return n > 1 ? n / 100 : n;
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
