export interface SheetQueryFilter {
  column: string;
  op?: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string | number | boolean | null;
}

export interface SheetAggregate {
  column: string;
  op: 'sum' | 'avg' | 'min' | 'max' | 'count';
}

export interface SheetQueryInput {
  /** Aggregations over matched rows (optional; returns groups/summary). */
  aggregates?: SheetAggregate[];
  columns?: string[];
  cursor?: string;
  filters?: SheetQueryFilter[];
  /** Group keys for aggregates (omit for whole-table summary). */
  groupBy?: string[];
  limit?: number;
  orderBy?: { column: string; direction?: 'asc' | 'desc' }[];
}

export interface SheetQueryResult {
  /** True when orderBy could not scan the full table (scan cap hit). */
  coverageLimited?: boolean;
  /** Grouped aggregate rows when aggregates requested. */
  groups?: Array<Record<string, string | number | null>>;
  hasMore?: boolean;
  nextCursor?: string;
  returnedRows: number;
  rows: Record<string, string>[];
  scannedRows: number;
  /** Whole-table or per-query aggregate summary. */
  summary?: Record<string, number | null>;
  /** Total group count before pagination (aggregates + groupBy). */
  totalGroups?: number;
  totalRows: number;
  truncated: boolean;
}

export const SHEET_QUERY_DEFAULT_LIMIT = 50;
export const SHEET_QUERY_MAX_LIMIT = 200;
export const SHEET_QUERY_MAX_SCAN = 50_000;
export const SHEET_QUERY_MAX_CHARS = 40_000;

const decodeCursor = (cursor?: string): number => {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const matchFilter = (row: Record<string, string>, filter: SheetQueryFilter): boolean => {
  const raw = row[filter.column] ?? '';
  const op = filter.op ?? 'eq';
  const value = filter.value;
  if (op === 'contains') return raw.toLowerCase().includes(String(value ?? '').toLowerCase());
  if (op === 'eq') return raw === String(value ?? '');
  const left = Number(raw);
  const right = Number(value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (op === 'gt') return left > right;
  if (op === 'gte') return left >= right;
  if (op === 'lt') return left < right;
  if (op === 'lte') return left <= right;
  return false;
};

const projectRow = (row: Record<string, string>, columns?: string[]): Record<string, string> => {
  if (!columns?.length) return row;
  const out: Record<string, string> = {};
  for (const c of columns) out[c] = row[c] ?? '';
  return out;
};

/** Cap a single cell/value so one row cannot exceed the page char budget alone. */
const clampRowForBudget = (
  row: Record<string, string>,
  maxChars: number,
): Record<string, string> => {
  const raw = JSON.stringify(row);
  if (raw.length <= maxChars) return row;
  // Prefer shrinking longest string fields first.
  const entries = Object.entries(row).sort((a, b) => b[1].length - a[1].length);
  const out = { ...row };
  let encoded = raw;
  for (const [key, val] of entries) {
    if (encoded.length <= maxChars) break;
    const overflow = encoded.length - maxChars + 1; // room for …
    if (val.length <= 1) continue;
    const keep = Math.max(0, val.length - overflow);
    out[key] = keep === 0 ? '…' : `${val.slice(0, keep)}…`;
    encoded = JSON.stringify(out);
  }
  if (encoded.length > maxChars) {
    // Last resort: single field dump
    return { _truncated: encoded.slice(0, Math.max(0, maxChars - 20)) + '…' };
  }
  return out;
};

const compareRows = (
  a: Record<string, string>,
  b: Record<string, string>,
  column: string,
  direction: 'asc' | 'desc',
): number => {
  const av = a[column] ?? '';
  const bv = b[column] ?? '';
  const an = Number(av);
  const bn = Number(bv);
  const cmp =
    Number.isFinite(an) && Number.isFinite(bn)
      ? an - bn
      : av.localeCompare(bv, undefined, { numeric: true });
  return direction === 'desc' ? -cmp : cmp;
};

const parseJsonlLines = (jsonl: string): { lines: string[]; totalRows: number } => {
  if (jsonl.length === 0) return { lines: [], totalRows: 0 };
  const lines = jsonl.split('\n');
  if (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return { lines, totalRows: lines.length };
};

const parseLine = (line: string): Record<string, string> | null => {
  if (!line) return null;
  try {
    return JSON.parse(line) as Record<string, string>;
  } catch {
    return null;
  }
};

/** Apply page char budget including single-row clamp (shared with file/stream paths). */
export const applySheetCharBudget = (
  rows: Record<string, string>[],
  maxChars: number = SHEET_QUERY_MAX_CHARS,
): { rows: Record<string, string>[]; truncated: boolean } => {
  if (rows.length === 0) return { rows, truncated: false };
  let page = rows.map((r) => clampRowForBudget(r, maxChars));
  let chars = JSON.stringify(page).length;
  let truncated = page.some((r, i) => JSON.stringify(r) !== JSON.stringify(rows[i]));
  while (page.length > 1 && chars > maxChars) {
    page = page.slice(0, -1);
    truncated = true;
    chars = JSON.stringify(page).length;
  }
  if (page.length === 1 && chars > maxChars) {
    page = [clampRowForBudget(page[0]!, Math.floor(maxChars * 0.9))];
    truncated = true;
  }
  return { rows: page, truncated };
};

const applyCharBudget = applySheetCharBudget;

/**
 * Query newline-delimited JSON rows with cursor pagination and hard caps.
 *
 * Cursor:
 * - no orderBy: absolute source index (stable; char shrink re-offers trimmed rows)
 * - orderBy: offset into filtered+sorted stream of **raw** rows (project after sort)
 *
 * orderBy never claims full-table sort past SHEET_QUERY_MAX_SCAN — sets coverageLimited.
 */
/**
 * Parse common ops spreadsheet numbers: 1,200.50 / ¥1,200.50 / $300 / 12% / (1,200).
 * Percent returns fraction (12% → 0.12). Currency symbols stripped.
 */
export const parseSheetNumber = (raw: string): number | null => {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  // Parentheses accounting: (1,200) → -1200
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  const isPercent = s.endsWith('%');
  if (isPercent) s = s.slice(0, -1).trim();
  // Strip currency / spaces / NBSP
  s = s.replaceAll(/[¥$€£￥\s]/g, '').replaceAll(',', '');
  if (!s || s === '-' || s === '+') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  let value = neg ? -n : n;
  if (isPercent) value = value / 100;
  return value;
};

const toNumber = (raw: string): number | null => parseSheetNumber(raw);

const aggregateKey = (agg: SheetAggregate) => `${agg.op}_${agg.column}`;

const applyAggregates = (
  rows: Record<string, string>[],
  input: SheetQueryInput,
): Pick<SheetQueryResult, 'groups' | 'summary'> => {
  const aggregates = input.aggregates ?? [];
  if (aggregates.length === 0) return {};

  const groupBy = input.groupBy?.filter(Boolean) ?? [];
  if (groupBy.length === 0) {
    const summary: Record<string, number | null> = {};
    for (const agg of aggregates) {
      const key = aggregateKey(agg);
      if (agg.op === 'count') {
        summary[key] = rows.length;
        continue;
      }
      const nums = rows
        .map((r) => toNumber(r[agg.column] ?? ''))
        .filter((n): n is number => n !== null);
      if (nums.length === 0) {
        summary[key] = null;
        continue;
      }
      if (agg.op === 'sum') summary[key] = nums.reduce((a, b) => a + b, 0);
      else if (agg.op === 'avg') summary[key] = nums.reduce((a, b) => a + b, 0) / nums.length;
      else if (agg.op === 'min') summary[key] = Math.min(...nums);
      else if (agg.op === 'max') summary[key] = Math.max(...nums);
    }
    return { summary };
  }

  const buckets = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const gk = groupBy.map((c) => row[c] ?? '').join('\u0001');
    const list = buckets.get(gk) ?? [];
    list.push(row);
    buckets.set(gk, list);
  }

  const groups: Array<Record<string, string | number | null>> = [];
  for (const [, bucket] of buckets) {
    const head = bucket[0]!;
    const entry: Record<string, string | number | null> = {};
    for (const c of groupBy) entry[c] = head[c] ?? '';
    entry.count = bucket.length;
    for (const agg of aggregates) {
      const key = aggregateKey(agg);
      if (agg.op === 'count') {
        entry[key] = bucket.length;
        continue;
      }
      const nums = bucket
        .map((r) => toNumber(r[agg.column] ?? ''))
        .filter((n): n is number => n !== null);
      if (nums.length === 0) {
        entry[key] = null;
        continue;
      }
      if (agg.op === 'sum') entry[key] = nums.reduce((a, b) => a + b, 0);
      else if (agg.op === 'avg') entry[key] = nums.reduce((a, b) => a + b, 0) / nums.length;
      else if (agg.op === 'min') entry[key] = Math.min(...nums);
      else if (agg.op === 'max') entry[key] = Math.max(...nums);
    }
    groups.push(entry);
  }

  // Sort groups by first aggregate desc when possible (Top-N friendly)
  const firstAgg = aggregates[0];
  if (firstAgg) {
    const k = aggregateKey(firstAgg);
    groups.sort((a, b) => {
      const av = typeof a[k] === 'number' ? (a[k] as number) : 0;
      const bv = typeof b[k] === 'number' ? (b[k] as number) : 0;
      return bv - av;
    });
  }

  return { groups };
};

export function queryJsonlSheet(jsonl: string, input: SheetQueryInput = {}): SheetQueryResult {
  const limit = Math.min(
    Math.max(1, input.limit ?? SHEET_QUERY_DEFAULT_LIMIT),
    SHEET_QUERY_MAX_LIMIT,
  );
  const start = decodeCursor(input.cursor);
  const { lines, totalRows } = parseJsonlLines(jsonl);
  const orderBy = input.orderBy?.[0];
  const wantsAggregate = Boolean(input.aggregates?.length);

  // Aggregate path: scan matched rows (cap), compute groups/summary, optional sample rows.
  if (wantsAggregate) {
    const matched: Record<string, string>[] = [];
    let scanned = 0;
    for (let i = 0; i < lines.length; i++) {
      if (scanned >= SHEET_QUERY_MAX_SCAN) break;
      scanned++;
      const row = parseLine(lines[i]!);
      if (!row) continue;
      if (input.filters?.length && !input.filters.every((f) => matchFilter(row, f))) continue;
      matched.push(row);
    }
    const coverageLimited = scanned >= SHEET_QUERY_MAX_SCAN && scanned < totalRows;
    const { groups, summary } = applyAggregates(matched, input);
    const allGroups = groups ?? [];
    const totalGroups = allGroups.length;
    const groupStart = start;
    const pagedGroups = allGroups.slice(groupStart, groupStart + limit);
    const moreGroups = groupStart + pagedGroups.length < totalGroups;
    const sample = matched.slice(0, Math.min(limit, 20)).map((r) => projectRow(r, input.columns));
    const hasMore = moreGroups || Boolean(coverageLimited);
    return {
      coverageLimited: coverageLimited || undefined,
      groups: pagedGroups,
      hasMore,
      nextCursor: moreGroups ? String(groupStart + pagedGroups.length) : undefined,
      returnedRows: sample.length,
      rows: sample,
      scannedRows: scanned,
      summary,
      totalGroups,
      totalRows,
      truncated: hasMore,
    };
  }

  if (orderBy) {
    const matched: Record<string, string>[] = [];
    let scanned = 0;
    for (let i = 0; i < lines.length; i++) {
      if (scanned >= SHEET_QUERY_MAX_SCAN) break;
      scanned++;
      const row = parseLine(lines[i]!);
      if (!row) continue;
      if (input.filters?.length && !input.filters.every((f) => matchFilter(row, f))) continue;
      // Keep raw row until after sort so orderBy.column survives columns projection.
      matched.push(row);
    }
    const coverageLimited = scanned >= SHEET_QUERY_MAX_SCAN && scanned < totalRows;
    matched.sort((a, b) => compareRows(a, b, orderBy.column, orderBy.direction ?? 'asc'));

    const slice = matched.slice(start, start + limit);
    const { rows: budgeted, truncated: charTruncated } = applyCharBudget(slice);
    // If char budget dropped rows from the end of this page, nextCursor is start+kept.
    const kept = budgeted.length;
    const nextOffset = start + kept;
    const moreInSorted = nextOffset < matched.length;
    // Do not emit a cursor that would re-fetch the same empty tail after scan cap
    // when we've already returned the last page of the scanned window.
    const truncated = moreInSorted || charTruncated;
    // When coverageLimited and no more in matched window, stop pagination (no infinite cursor).
    const nextCursor =
      moreInSorted || (charTruncated && kept < slice.length) ? String(nextOffset) : undefined;

    const hasMore = Boolean(nextCursor) || truncated || coverageLimited;
    return {
      coverageLimited: coverageLimited || undefined,
      hasMore,
      nextCursor,
      returnedRows: budgeted.length,
      rows: budgeted.map((r) => projectRow(r, input.columns)),
      scannedRows: scanned,
      totalRows,
      truncated: hasMore,
    };
  }

  type Indexed = { row: Record<string, string>; sourceIndex: number };
  const matched: Indexed[] = [];
  let scanned = 0;
  let scanEnd = start;

  for (let i = start; i < lines.length; i++) {
    if (scanned >= SHEET_QUERY_MAX_SCAN) break;
    scanned++;
    scanEnd = i + 1;
    const row = parseLine(lines[i]!);
    if (!row) continue;
    if (input.filters?.length && !input.filters.every((f) => matchFilter(row, f))) continue;
    matched.push({ row, sourceIndex: i });
    if (matched.length >= limit) break;
  }

  const rawPage = matched.map((m) => m.row);
  const { rows: budgeted, truncated: charTruncated } = applyCharBudget(rawPage);
  const kept = matched.slice(0, budgeted.length);
  // Replace rows with budgeted (possibly clamped) content
  const finalRows = budgeted;

  let truncated = scanEnd < totalRows || scanned >= SHEET_QUERY_MAX_SCAN || charTruncated;
  const lastReturned = kept.at(-1);
  const nextCursorIndex = lastReturned !== undefined ? lastReturned.sourceIndex + 1 : scanEnd;
  if (lastReturned !== undefined && nextCursorIndex < totalRows) truncated = true;
  if (scanned >= SHEET_QUERY_MAX_SCAN && nextCursorIndex < totalRows) truncated = true;

  // Avoid stuck cursor: only set nextCursor when there is a later source index.
  const nextCursor =
    truncated && nextCursorIndex < totalRows && nextCursorIndex > start
      ? String(nextCursorIndex)
      : truncated && nextCursorIndex < totalRows
        ? String(nextCursorIndex)
        : undefined;

  const hasMore = Boolean(nextCursor) || charTruncated;
  return {
    hasMore,
    nextCursor,
    returnedRows: finalRows.length,
    rows: finalRows.map((r) => projectRow(r, input.columns)),
    scannedRows: scanned,
    totalRows,
    truncated: hasMore,
  };
}

export function queryJsonlLines(lines: string[], input: SheetQueryInput = {}): SheetQueryResult {
  return queryJsonlSheet(lines.join('\n'), input);
}
