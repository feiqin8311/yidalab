export interface SheetQueryFilter {
  column: string;
  op?: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string | number | boolean | null;
}

export interface SheetQueryInput {
  columns?: string[];
  cursor?: string;
  filters?: SheetQueryFilter[];
  limit?: number;
  orderBy?: { column: string; direction?: 'asc' | 'desc' }[];
}

export interface SheetQueryResult {
  /** True when orderBy could not scan the full table (scan cap hit). */
  coverageLimited?: boolean;
  nextCursor?: string;
  returnedRows: number;
  rows: Record<string, string>[];
  scannedRows: number;
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

const applyCharBudget = (
  rows: Record<string, string>[],
): { rows: Record<string, string>[]; truncated: boolean } => {
  if (rows.length === 0) return { rows, truncated: false };
  let page = rows.map((r) => clampRowForBudget(r, SHEET_QUERY_MAX_CHARS));
  let chars = JSON.stringify(page).length;
  let truncated = page.some((r, i) => JSON.stringify(r) !== JSON.stringify(rows[i]));
  while (page.length > 1 && chars > SHEET_QUERY_MAX_CHARS) {
    page = page.slice(0, -1);
    truncated = true;
    chars = JSON.stringify(page).length;
  }
  // Single row still over budget after clamp (should be rare): keep clamped form.
  if (page.length === 1 && chars > SHEET_QUERY_MAX_CHARS) {
    page = [clampRowForBudget(page[0]!, Math.floor(SHEET_QUERY_MAX_CHARS * 0.9))];
    truncated = true;
  }
  return { rows: page, truncated };
};

/**
 * Query newline-delimited JSON rows with cursor pagination and hard caps.
 *
 * Cursor:
 * - no orderBy: absolute source index (stable; char shrink re-offers trimmed rows)
 * - orderBy: offset into filtered+sorted stream of **raw** rows (project after sort)
 *
 * orderBy never claims full-table sort past SHEET_QUERY_MAX_SCAN — sets coverageLimited.
 */
export function queryJsonlSheet(jsonl: string, input: SheetQueryInput = {}): SheetQueryResult {
  const limit = Math.min(
    Math.max(1, input.limit ?? SHEET_QUERY_DEFAULT_LIMIT),
    SHEET_QUERY_MAX_LIMIT,
  );
  const start = decodeCursor(input.cursor);
  const { lines, totalRows } = parseJsonlLines(jsonl);
  const orderBy = input.orderBy?.[0];

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

    return {
      coverageLimited: coverageLimited || undefined,
      nextCursor,
      returnedRows: budgeted.length,
      rows: budgeted.map((r) => projectRow(r, input.columns)),
      scannedRows: scanned,
      totalRows,
      truncated: truncated || coverageLimited,
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

  return {
    nextCursor,
    returnedRows: finalRows.length,
    rows: finalRows.map((r) => projectRow(r, input.columns)),
    scannedRows: scanned,
    totalRows,
    truncated: Boolean(nextCursor) || charTruncated,
  };
}

export function queryJsonlLines(lines: string[], input: SheetQueryInput = {}): SheetQueryResult {
  return queryJsonlSheet(lines.join('\n'), input);
}
