/** Channel metric helpers — pure arithmetic. */

import type { ChannelMetrics } from './types';

export const safeDiv = (num?: number | null, den?: number | null): number | null => {
  if (num == null || den == null || den === 0) return null;
  return num / den;
};

export const cvr = (orders?: number | null, clicks?: number | null) => safeDiv(orders, clicks);
export const acos = (spend?: number | null, sales?: number | null) => safeDiv(spend, sales);

export const withRates = (m: ChannelMetrics = {}): ChannelMetrics => ({
  ...m,
  cvr: cvr(m.orders, m.clicks),
  acos: acos(m.spend, m.sales),
});

export const addMetrics = (a: ChannelMetrics = {}, b: ChannelMetrics = {}): ChannelMetrics =>
  withRates({
    impressions: (a.impressions ?? 0) + (b.impressions ?? 0),
    clicks: (a.clicks ?? 0) + (b.clicks ?? 0),
    spend: (a.spend ?? 0) + (b.spend ?? 0),
    sales: (a.sales ?? 0) + (b.sales ?? 0),
    orders: (a.orders ?? 0) + (b.orders ?? 0),
  });

export const parseNumber = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v)
    .replaceAll(/[$,%\s]/g, '')
    .trim();
  if (!s || s === '-' || s === '—') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export const parsePercent = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) {
    // values like 0.12 or 12 both possible — if > 1 treat as percent points
    return v > 1 ? v / 100 : v;
  }
  const s = String(v).trim();
  const hasPct = s.includes('%');
  const n = parseNumber(s);
  if (n == null) return undefined;
  return hasPct || n > 1 ? n / 100 : n;
};

/** Window end = max valid date; last30 = end-29..end; prev30 = end-59..end-30. */
export const buildDateWindows = (endDate: Date) => {
  const end = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()),
  );
  const day = 24 * 60 * 60 * 1000;
  const last30Start = new Date(end.getTime() - 29 * day);
  const prev30End = new Date(end.getTime() - 30 * day);
  const prev30Start = new Date(end.getTime() - 59 * day);
  return { end, last30Start, prev30End, prev30Start };
};

export const inRange = (d: Date, start: Date, end: Date) =>
  d.getTime() >= start.getTime() && d.getTime() <= end.getTime();

export const spTrend = (
  last30Orders: number,
  prev30Orders: number,
): { trend: number | null; label?: string } => {
  if (prev30Orders === 0 && last30Orders > 0) return { trend: null, label: '新增' };
  if (prev30Orders === 0) return { trend: null };
  return { trend: (last30Orders - prev30Orders) / prev30Orders };
};

export const classifySbChannel = (
  campaign?: string,
  adGroup?: string,
  portfolio?: string,
): 'sbv' | 'sbh' | 'other' => {
  const blob = `${campaign ?? ''} ${adGroup ?? ''} ${portfolio ?? ''}`.toLowerCase();
  if (blob.includes('sbv') || blob.includes('视频') || blob.includes('video')) return 'sbv';
  if (
    blob.includes('sbh') ||
    blob.includes('品牌头条') ||
    blob.includes('头条') ||
    blob.includes('headline')
  )
    return 'sbh';
  return 'other';
};
