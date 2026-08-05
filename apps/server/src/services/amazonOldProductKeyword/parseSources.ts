/**
 * Parse uploaded source files into normalized row maps.
 * Uses sheetjs (xlsx) already in monorepo.
 */
import {
  addMetrics,
  buildDateWindows,
  type ChannelMetrics,
  classifySbChannel,
  type DailyTrendRow,
  type DataSourceRole,
  displayKeyword,
  extractAsin,
  inRange,
  isExactAsin,
  type KeywordEvidence,
  normalizeKeywordKey,
  parseNumber,
  parsePercent,
  type SpTargetingRow,
  spTrend,
  withRates,
} from '@lobechat/utils';
import * as XLSX from 'xlsx';

export type ParsedSources = {
  keywords: Map<string, KeywordEvidence>;
  dailyTrend: DailyTrendRow[];
  spTargeting: SpTargetingRow[];
  productHtmlText: string;
  sourceStats: Partial<
    Record<
      DataSourceRole,
      {
        sheetNames: string[];
        rawRowCount: number;
        includedRowCount: number;
        dateRange?: { start?: string; end?: string };
        notes: string[];
      }
    >
  >;
  spOrderAudit: {
    totalOrders: number;
    naturalOrders: number;
    asinOrders: number;
  };
};

const ensure = (map: Map<string, KeywordEvidence>, raw: string): KeywordEvidence => {
  const keywordKey = normalizeKeywordKey(raw);
  const existing = map.get(keywordKey);
  if (existing) return existing;
  const row: KeywordEvidence = {
    keyword: displayKeyword(raw),
    keywordKey,
    isExactAsin: isExactAsin(raw),
    sources: [],
    dataSourceTags: [],
  };
  map.set(keywordKey, row);
  return row;
};

const tag = (row: KeywordEvidence, t: string) => {
  if (!row.dataSourceTags) row.dataSourceTags = [];
  if (!row.dataSourceTags.includes(t)) row.dataSourceTags.push(t);
};

const headerIndex = (headers: string[], candidates: string[]) => {
  const lower = headers.map((h) => h.toLowerCase().replaceAll(/\s+/g, ''));
  for (const c of candidates) {
    const key = c.toLowerCase().replaceAll(/\s+/g, '');
    const i = lower.findIndex((h) => h.includes(key) || key.includes(h));
    if (i >= 0) return i;
  }
  return -1;
};

const sheetRows = (wb: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] => {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
};

const allRows = (wb: XLSX.WorkBook) => {
  const rows: Record<string, unknown>[] = [];
  for (const name of wb.SheetNames) rows.push(...sheetRows(wb, name));
  return rows;
};

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  const headers = Object.keys(row);
  const idx = headerIndex(headers, keys);
  if (idx < 0) return undefined;
  return row[headers[idx]!];
};

const parseDate = (v: unknown): Date | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = String(v).trim();
  // excel serial
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 60000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(epoch.getTime() + n * 86400000);
    }
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

export const readWorkbook = (bytes: Uint8Array) =>
  XLSX.read(bytes, { type: 'array', cellDates: true });

export const parseHistorical = (wb: XLSX.WorkBook, map: Map<string, KeywordEvidence>) => {
  const rows = allRows(wb);
  let included = 0;
  for (const row of rows) {
    const kw = pick(row, ['搜索词', '客户搜索词', '关键词', 'search term', 'customer search term']);
    if (!kw) continue;
    const r = ensure(map, String(kw));
    tag(r, '历史');
    r.history = addMetrics(r.history, {
      impressions: parseNumber(pick(row, ['曝光', '展示', 'impressions'])),
      clicks: parseNumber(pick(row, ['点击', 'clicks'])),
      spend: parseNumber(pick(row, ['花费', 'spend', 'cost'])),
      sales: parseNumber(pick(row, ['销售额', '销售', 'sales'])),
      orders: parseNumber(pick(row, ['订单', 'orders', '7天总订单数', '14天总订单数'])),
    });
    included++;
  }
  return { rawRowCount: rows.length, includedRowCount: included, sheetNames: wb.SheetNames };
};

export const parseSpSearchTerms = (wb: XLSX.WorkBook, map: Map<string, KeywordEvidence>) => {
  const rows = allRows(wb);
  // dedupe full row by JSON
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const dates: Date[] = [];
  for (const row of unique) {
    const d = parseDate(pick(row, ['日期', 'date', '开始日期']));
    if (d) dates.push(d);
  }
  const maxDate = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();
  const windows = buildDateWindows(maxDate);
  const daily = new Map<string, DailyTrendRow>();
  let naturalOrders = 0;
  let asinOrders = 0;
  let totalOrders = 0;
  let included = 0;

  for (const row of unique) {
    const kwRaw = pick(row, ['客户搜索词', '搜索词', 'customer search term', 'query']);
    if (!kwRaw) continue;
    const r = ensure(map, String(kwRaw));
    tag(r, 'SP搜索词');
    const metrics: ChannelMetrics = {
      impressions: parseNumber(pick(row, ['展示量', '曝光量', 'impressions'])),
      clicks: parseNumber(pick(row, ['点击量', '点击', 'clicks'])),
      spend: parseNumber(pick(row, ['花费', 'spend', 'cost'])),
      sales: parseNumber(pick(row, ['7天总销售额', '14天总销售额', '销售额', 'sales'])),
      orders: parseNumber(pick(row, ['7天总订单数', '14天总订单数', '订单', 'orders'])),
    };
    r.sp = addMetrics(r.sp, metrics);
    const d = parseDate(pick(row, ['日期', 'date', '开始日期']));
    if (d) {
      if (inRange(d, windows.last30Start, windows.end)) {
        r.sp = { ...r.sp!, last30: addMetrics(r.sp?.last30, metrics) };
      } else if (inRange(d, windows.prev30Start, windows.prev30End)) {
        r.sp = { ...r.sp!, prev30: addMetrics(r.sp?.prev30, metrics) };
      }
      const iso = toIsoDate(d);
      const day = daily.get(iso) ?? { date: iso };
      day.spImpressions = (day.spImpressions ?? 0) + (metrics.impressions ?? 0);
      day.spClicks = (day.spClicks ?? 0) + (metrics.clicks ?? 0);
      day.spSpend = (day.spSpend ?? 0) + (metrics.spend ?? 0);
      day.spSales = (day.spSales ?? 0) + (metrics.sales ?? 0);
      day.spOrders = (day.spOrders ?? 0) + (metrics.orders ?? 0);
      daily.set(iso, day);
    }

    const campaign = String(pick(row, ['广告活动', '广告活动名称', 'campaign']) ?? '');
    const adGroup = String(pick(row, ['广告组', '广告组名称', 'ad group']) ?? '');
    const match = String(pick(row, ['匹配类型', 'match type', '投放']) ?? '');
    if (campaign || adGroup) {
      r.sources = r.sources ?? [];
      r.sources.push({
        channel: 'SP',
        campaign: campaign || undefined,
        adGroup: adGroup || undefined,
        matchOrTarget: match || undefined,
        orders: metrics.orders,
        spend: metrics.spend,
        sales: metrics.sales,
        clicks: metrics.clicks,
      });
    }

    const orders = metrics.orders ?? 0;
    totalOrders += orders;
    if (r.isExactAsin) asinOrders += orders;
    else naturalOrders += orders;
    included++;
  }

  for (const r of map.values()) {
    if (r.sp) {
      const last = r.sp.last30?.orders ?? 0;
      const prev = r.sp.prev30?.orders ?? 0;
      const t = spTrend(last, prev);
      r.sp.trend = t.trend;
      r.sp.trendLabel = t.label;
      r.sp = withRates(r.sp);
    }
  }

  const dateRange =
    dates.length > 0
      ? {
          start: toIsoDate(new Date(Math.min(...dates.map((d) => d.getTime())))),
          end: toIsoDate(maxDate),
        }
      : undefined;

  return {
    rawRowCount: rows.length,
    includedRowCount: included,
    sheetNames: wb.SheetNames,
    dateRange,
    dailyTrend: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    spOrderAudit: { totalOrders, naturalOrders, asinOrders },
    notes: rows.length !== unique.length ? [`去重 ${rows.length - unique.length} 行`] : [],
  };
};

export const parseSbSearchTerms = (wb: XLSX.WorkBook, map: Map<string, KeywordEvidence>) => {
  const rows = allRows(wb);
  const daily = new Map<string, DailyTrendRow>();
  let included = 0;
  const dates: Date[] = [];

  for (const row of rows) {
    const kwRaw = pick(row, ['客户搜索词', '搜索词', 'customer search term', 'query']);
    if (!kwRaw) continue;
    const r = ensure(map, String(kwRaw));
    tag(r, 'SB搜索词');
    const campaign = String(pick(row, ['广告活动', '广告活动名称', 'campaign']) ?? '');
    const adGroup = String(pick(row, ['广告组', '广告组名称', 'ad group']) ?? '');
    const channel = classifySbChannel(campaign, adGroup);
    const clicks = parseNumber(pick(row, ['点击量', '点击', 'clicks']));
    const spend = parseNumber(pick(row, ['花费', 'spend', 'cost']));
    const impressions = parseNumber(pick(row, ['展示量', '曝光量', 'impressions']));
    const clickOrders = parseNumber(
      pick(row, ['点击归因订单', '点击订单', 'viewable click orders', 'click orders']),
    );
    const clickSales = parseNumber(pick(row, ['点击归因销售额', '点击销售额', 'click sales']));
    const totalOrders = parseNumber(pick(row, ['总订单', '14天总订单数', '7天总订单数', 'orders']));
    const totalSales = parseNumber(pick(row, ['总销售额', '14天总销售额', '销售额', 'sales']));

    const metrics: ChannelMetrics = {
      impressions,
      clicks,
      spend,
      sales: clickSales ?? totalSales,
      orders: clickOrders ?? totalOrders,
    };

    r.sb = r.sb ?? {};
    r.sb = {
      ...r.sb,
      ...addMetrics(r.sb, metrics),
      clickOrders: (r.sb.clickOrders ?? 0) + (clickOrders ?? 0),
      clickSales: (r.sb.clickSales ?? 0) + (clickSales ?? 0),
      assistOrders: (r.sb.assistOrders ?? 0) + Math.max(0, (totalOrders ?? 0) - (clickOrders ?? 0)),
      assistSales: (r.sb.assistSales ?? 0) + Math.max(0, (totalSales ?? 0) - (clickSales ?? 0)),
    };
    if (channel === 'sbv') r.sb.sbv = addMetrics(r.sb.sbv, metrics);
    else if (channel === 'sbh') r.sb.sbh = addMetrics(r.sb.sbh, metrics);
    else r.sb.other = addMetrics(r.sb.other, metrics);

    r.sources = r.sources ?? [];
    r.sources.push({
      channel: channel === 'sbv' ? 'SBV视频' : channel === 'sbh' ? 'SBH头条' : 'SB其他',
      campaign: campaign || undefined,
      adGroup: adGroup || undefined,
      matchOrTarget: String(pick(row, ['匹配类型', '投放']) ?? '') || undefined,
      orders: clickOrders,
      spend,
      sales: clickSales,
      clicks,
    });

    const d = parseDate(pick(row, ['日期', 'date']));
    if (d) {
      dates.push(d);
      const iso = toIsoDate(d);
      const day = daily.get(iso) ?? { date: iso };
      day.sbImpressions = (day.sbImpressions ?? 0) + (impressions ?? 0);
      day.sbClicks = (day.sbClicks ?? 0) + (clicks ?? 0);
      day.sbSpend = (day.sbSpend ?? 0) + (spend ?? 0);
      day.sbClickSales = (day.sbClickSales ?? 0) + (clickSales ?? 0);
      day.sbClickOrders = (day.sbClickOrders ?? 0) + (clickOrders ?? 0);
      day.sbTotalOrders = (day.sbTotalOrders ?? 0) + (totalOrders ?? 0);
      daily.set(iso, day);
    }
    included++;
  }

  return {
    rawRowCount: rows.length,
    includedRowCount: included,
    sheetNames: wb.SheetNames,
    dateRange:
      dates.length > 0
        ? {
            start: toIsoDate(new Date(Math.min(...dates.map((d) => d.getTime())))),
            end: toIsoDate(new Date(Math.max(...dates.map((d) => d.getTime())))),
          }
        : undefined,
    dailyTrend: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
};

export const parseImpressionShare = (wb: XLSX.WorkBook, map: Map<string, KeywordEvidence>) => {
  const rows = allRows(wb);
  let included = 0;
  const byKey = new Map<string, { shares: number[]; ranks: number[] }>();
  for (const row of rows) {
    const kw = pick(row, ['搜索词', '客户搜索词', 'customer search term', 'keyword']);
    if (!kw) continue;
    const key = normalizeKeywordKey(String(kw));
    const share = parsePercent(pick(row, ['展示量份额', 'impression share', '份额']));
    const rank = parseNumber(pick(row, ['展示量排名', 'impression rank', '排名']));
    const bucket = byKey.get(key) ?? { shares: [], ranks: [] };
    if (share != null) bucket.shares.push(share);
    if (rank != null) bucket.ranks.push(rank);
    byKey.set(key, bucket);
    included++;
  }
  for (const [key, b] of byKey) {
    const r = map.get(key) ?? ensure(map, key);
    tag(r, '展示份额');
    r.impressionShare = {
      avgShare: b.shares.length ? b.shares.reduce((a, c) => a + c, 0) / b.shares.length : null,
      latestShare: b.shares.length ? b.shares.at(-1)! : null,
      avgRank: b.ranks.length ? b.ranks.reduce((a, c) => a + c, 0) / b.ranks.length : null,
      latestRank: b.ranks.length ? b.ranks.at(-1)! : null,
    };
  }
  return { rawRowCount: rows.length, includedRowCount: included, sheetNames: wb.SheetNames };
};

export const parseSpTargeting = (wb: XLSX.WorkBook) => {
  const rows = allRows(wb);
  const out: SpTargetingRow[] = [];
  for (const row of rows) {
    const target = String(pick(row, ['投放', '投放对象', 'targeting', '关键词']) ?? '');
    if (!target) continue;
    const matchType = String(pick(row, ['匹配类型', 'match type']) ?? '');
    const asin = extractAsin(target);
    let targetType = '关键词';
    if (asin) targetType = 'ASIN';
    else if (/auto|自动/i.test(target) || /auto|自动/i.test(matchType)) targetType = '自动';
    else if (/category|类目/i.test(target)) targetType = '类目';

    const metrics = withRates({
      impressions: parseNumber(pick(row, ['展示量', '曝光量', 'impressions'])),
      clicks: parseNumber(pick(row, ['点击量', '点击', 'clicks'])),
      spend: parseNumber(pick(row, ['花费', 'spend', 'cost'])),
      sales: parseNumber(pick(row, ['销售额', 'sales'])),
      orders: parseNumber(pick(row, ['订单', 'orders'])),
    });
    const orders = metrics.orders ?? 0;
    const spend = metrics.spend ?? 0;
    const clicks = metrics.clicks ?? 0;
    let suggestion = '数据不足';
    let rationale = '未达到明确保留或否定阈值';
    if (orders > 0 && (metrics.acos == null || metrics.acos <= 0.45)) {
      suggestion = '保留';
      rationale = '有订单且效率可接受';
    } else if (orders === 0 && (spend >= 10 || clicks >= 8)) {
      suggestion = asin ? '商品否定候选' : '降价/暂停或否定复核';
      rationale = '无订单且达到花费/点击阈值';
    } else if (orders > 0 && metrics.acos != null && metrics.acos > 0.7) {
      suggestion = '降价复核';
      rationale = '有订单但ACoS过高';
    }
    out.push({
      targetType,
      target,
      matchType: matchType || undefined,
      asin,
      ...metrics,
      suggestion,
      rationale,
    });
  }
  return {
    rows: out,
    rawRowCount: rows.length,
    includedRowCount: out.length,
    sheetNames: wb.SheetNames,
  };
};

export const parseMultiAsin = (
  wb: XLSX.WorkBook,
  map: Map<string, KeywordEvidence>,
  mainAsin: string,
) => {
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
  }) as any[][];
  if (!matrix.length) {
    return { rawRowCount: 0, includedRowCount: 0, sheetNames: wb.SheetNames };
  }

  // Find header row with 关键词 / keyword
  let headerRow = 0;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    const row = matrix[i] ?? [];
    if (row.some((c) => /关键词|keyword|搜索词/i.test(String(c ?? '')))) {
      headerRow = i;
      break;
    }
  }
  const headers = (matrix[headerRow] ?? []).map((h) => String(h ?? ''));
  const kwIdx = headers.findIndex((h) => /关键词|keyword|搜索词/i.test(h));

  // Detect ASIN columns from header like B0...
  const asinCols: { asin: string; natural?: number; sp?: number; share?: number; pos?: number }[] =
    [];
  const asinHeaderRe = /(B0[A-Z0-9]{8})/i;
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c]!;
    const m = h.match(asinHeaderRe);
    if (!m) continue;
    const asin = m[1]!.toUpperCase();
    let entry = asinCols.find((x) => x.asin === asin);
    if (!entry) {
      entry = { asin };
      asinCols.push(entry);
    }
    if (/自然|organic/i.test(h)) entry.natural = c;
    else if (/SP|广告位|广告排名|付费/i.test(h)) entry.sp = c;
    else if (/流量|份额|share/i.test(h)) entry.share = c;
    else if (/展示位置|position/i.test(h)) entry.pos = c;
    else if (entry.natural == null) entry.natural = c;
  }

  let included = 0;
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const kw = kwIdx >= 0 ? row[kwIdx] : row[0];
    if (!kw) continue;
    const ev = ensure(map, String(kw));
    tag(ev, '多ASIN位次');
    const main = mainAsin.toUpperCase();
    let ownNatural: number | null = null;
    let ownSp: number | null = null;
    let ownShare: number | null = null;
    let ownPaid = false;
    let bestCompNatural: number | null = null;
    let bestCompAsin: string | null = null;
    let top48 = 0;
    let top20 = 0;
    let compPaid = 0;
    let maxCompShare: number | null = null;
    let maxCompShareAsin: string | null = null;

    for (const col of asinCols) {
      const natural = col.natural != null ? (parseNumber(row[col.natural]) ?? null) : null;
      const sp = col.sp != null ? (parseNumber(row[col.sp]) ?? null) : null;
      const share = col.share != null ? (parsePercent(row[col.share]) ?? null) : null;
      const pos = col.pos != null ? String(row[col.pos] ?? '') : '';
      const paid = sp != null || /SP|SB/i.test(pos);

      if (col.asin === main) {
        ownNatural = natural;
        ownSp = sp;
        ownShare = share;
        ownPaid = paid;
      } else {
        if (natural != null) {
          if (natural <= 48) top48++;
          if (natural <= 20) top20++;
          if (bestCompNatural == null || natural < bestCompNatural) {
            bestCompNatural = natural;
            bestCompAsin = col.asin;
          }
        }
        if (paid) compPaid++;
        if (share != null && (maxCompShare == null || share > maxCompShare)) {
          maxCompShare = share;
          maxCompShareAsin = col.asin;
        }
      }
    }

    const gap = ownNatural != null && bestCompNatural != null ? ownNatural - bestCompNatural : null;
    ev.multiAsin = {
      ownNaturalRank: ownNatural,
      bestCompNaturalRank: bestCompNatural,
      bestCompNaturalAsin: bestCompAsin,
      compNaturalTop48Count: top48,
      compNaturalTop20Count: top20,
      ownSpRank: ownSp,
      ownPaidPresent: ownPaid,
      compPaidCount: compPaid,
      ownTrafficShare: ownShare,
      maxCompTrafficShare: maxCompShare,
      maxCompTrafficAsin: maxCompShareAsin,
      naturalRankGap: gap,
    };
    included++;
  }

  return {
    rawRowCount: Math.max(0, matrix.length - headerRow - 1),
    includedRowCount: included,
    sheetNames: wb.SheetNames,
  };
};

export const mergeCurrentMetrics = (map: Map<string, KeywordEvidence>) => {
  for (const r of map.values()) {
    const sp = r.sp ?? {};
    const sbOrders = r.sb?.clickOrders ?? 0;
    const sbSales = r.sb?.clickSales ?? 0;
    const sbClicks = r.sb?.clicks ?? 0;
    const sbSpend = r.sb?.spend ?? 0;
    r.current = withRates({
      impressions: (sp.impressions ?? 0) + (r.sb?.impressions ?? 0),
      clicks: (sp.clicks ?? 0) + sbClicks,
      spend: (sp.spend ?? 0) + sbSpend,
      sales: (sp.sales ?? 0) + sbSales,
      orders: (sp.orders ?? 0) + sbOrders,
    });
  }
};

export const mergeDaily = (a: DailyTrendRow[], b: DailyTrendRow[]): DailyTrendRow[] => {
  const map = new Map<string, DailyTrendRow>();
  for (const row of [...a, ...b]) {
    const cur = map.get(row.date) ?? { date: row.date };
    map.set(row.date, {
      date: row.date,
      spImpressions: (cur.spImpressions ?? 0) + (row.spImpressions ?? 0),
      spClicks: (cur.spClicks ?? 0) + (row.spClicks ?? 0),
      spSpend: (cur.spSpend ?? 0) + (row.spSpend ?? 0),
      spSales: (cur.spSales ?? 0) + (row.spSales ?? 0),
      spOrders: (cur.spOrders ?? 0) + (row.spOrders ?? 0),
      sbImpressions: (cur.sbImpressions ?? 0) + (row.sbImpressions ?? 0),
      sbClicks: (cur.sbClicks ?? 0) + (row.sbClicks ?? 0),
      sbSpend: (cur.sbSpend ?? 0) + (row.sbSpend ?? 0),
      sbClickSales: (cur.sbClickSales ?? 0) + (row.sbClickSales ?? 0),
      sbClickOrders: (cur.sbClickOrders ?? 0) + (row.sbClickOrders ?? 0),
      sbTotalOrders: (cur.sbTotalOrders ?? 0) + (row.sbTotalOrders ?? 0),
    });
  }
  return [...map.values()]
    .map((d) => ({
      ...d,
      totalSpend: (d.spSpend ?? 0) + (d.sbSpend ?? 0),
      totalClickOrders: (d.spOrders ?? 0) + (d.sbClickOrders ?? 0),
    }))
    .sort((x, y) => x.date.localeCompare(y.date));
};

export const extractHtmlText = (html: string): string => {
  // strip scripts/styles then tags — keep text for AI product profile only
  return html
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 40_000);
};
