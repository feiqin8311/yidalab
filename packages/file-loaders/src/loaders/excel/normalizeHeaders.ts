import * as xlsx from 'xlsx';

/** Max header rows scanned for multi-level headers (merged cells). */
export const HEADER_SCAN_MAX_ROWS = 5;

export interface NormalizedSheetTable {
  /** Final column names after multi-level merge + dedupe. */
  columns: string[];
  /** How many leading rows were consumed as headers. */
  headerRowCount: number;
  /** Data rows keyed by final column names (string values). */
  rows: Record<string, string>[];
}

const cellToString = (value: unknown, maxChars = 2_000): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
};

const isEmptyLikeHeader = (name: string): boolean => {
  const t = name.trim();
  if (!t) return true;
  if (/^__EMPTY(?:_\d+)?$/i.test(t)) return true;
  if (/^col_\d+$/i.test(t)) return true;
  return false;
};

/**
 * Forward-fill blank cells within a single header row only
 * (merged multi-level labels). Never applied to data rows.
 */
const fillMergedRow = (row: string[]): string[] => {
  const out = [...row];
  let last = '';
  for (let i = 0; i < out.length; i++) {
    const v = out[i]!.trim();
    if (v && !isEmptyLikeHeader(v)) {
      last = v;
      out[i] = v;
    } else if (last) {
      out[i] = last;
    } else {
      out[i] = '';
    }
  }
  return out;
};

const dedupeColumnNames = (names: string[]): string[] => {
  const seen = new Map<string, number>();
  return names.map((raw, i) => {
    let base = raw.trim() || `col_${i + 1}`;
    if (isEmptyLikeHeader(base) && !raw.trim()) base = `col_${i + 1}`;
    if (isEmptyLikeHeader(base) && /^__EMPTY/i.test(base)) base = `col_${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
};

const scoreHeaderDepth = (matrix: string[][], depth: number, colCount: number): number => {
  if (depth < 1 || depth > matrix.length) return -1;
  const labels: string[] = [];
  for (let c = 0; c < colCount; c++) {
    const parts: string[] = [];
    for (let r = 0; r < depth; r++) {
      const cell = matrix[r]?.[c]?.trim() ?? '';
      if (cell && !isEmptyLikeHeader(cell)) parts.push(cell);
    }
    labels.push(parts.join(' / '));
  }
  const nonEmpty = labels.filter((l) => l.length > 0).length;
  const unique = new Set(labels.filter(Boolean)).size;
  const numericish = labels.filter(
    (l) => /^-?\d+(?:\.\d+)?$/.test(l) || /\/\s*-?\d+(?:\.\d+)?$/.test(l),
  ).length;
  return nonEmpty * 3 + unique * 2 - numericish * 8 - (depth - 1);
};

/**
 * Prefer depth=1 when row 0 already looks like a complete single header row
 * and row 1 looks like data (including categorical strings that equal header
 * labels — e.g. 状态/打开/关闭). Multi-level only when lower header rows
 * clearly add new label structure without looking like data.
 */
const looksLikeDataRow = (row: string[], headerLabels: string[]): boolean => {
  if (!row.length) return true;
  const nonEmpty = row.filter((c) => c.trim());
  if (nonEmpty.length === 0) return true;
  let numeric = 0;
  let matchesHeader = 0;
  for (const cell of nonEmpty) {
    if (parseSheetNumberLoose(cell) !== null) numeric++;
    if (headerLabels.includes(cell)) matchesHeader++;
  }
  // Mostly numbers → data
  if (numeric >= Math.ceil(nonEmpty.length * 0.5)) return true;
  // Values that already appear as top-level headers (open/closed under 状态) → data
  if (matchesHeader >= 1 && nonEmpty.length <= headerLabels.length) return true;
  return false;
};

const parseSheetNumberLoose = (raw: string): number | null => {
  const s = raw.replaceAll(/[¥$€£￥,\s%]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Build column names + data rows from a worksheet with multi-level header
 * detection (1–5 rows), merge fill limited to header zone, and name dedupe.
 *
 * Data rows are never horizontally filled — empty cells stay empty.
 */
export function normalizeWorksheetTable(
  worksheet: xlsx.WorkSheet,
  options?: {
    maxCellChars?: number;
    maxColumns?: number;
    maxHeaderRows?: number;
  },
): NormalizedSheetTable {
  const maxHeaderRows = options?.maxHeaderRows ?? HEADER_SCAN_MAX_ROWS;
  const maxColumns = options?.maxColumns ?? 200;
  const maxCellChars = options?.maxCellChars ?? 2_000;

  const matrixRaw = xlsx.utils.sheet_to_json<(string | number | boolean | null | undefined)[]>(
    worksheet,
    {
      defval: '',
      header: 1,
      raw: false,
    },
  );

  if (!matrixRaw.length) {
    return { columns: ['col_1'], headerRowCount: 0, rows: [] };
  }

  const colCount = Math.min(
    maxColumns,
    matrixRaw.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0),
  );

  if (colCount === 0) {
    return { columns: ['col_1'], headerRowCount: 0, rows: [] };
  }

  // Pristine matrix for data rows — never mutated by header fill.
  const dataMatrix: string[][] = matrixRaw.map((row) => {
    const arr = Array.isArray(row) ? row : [];
    const out: string[] = [];
    for (let c = 0; c < colCount; c++) {
      out.push(cellToString(arr[c], maxCellChars).trim());
    }
    return out;
  });

  // Header working copy (only first maxHeaderRows matter).
  const headerMatrix: string[][] = dataMatrix
    .slice(0, Math.min(maxHeaderRows, dataMatrix.length))
    .map((r) => [...r]);

  // Apply merges only when the entire merge is inside the header scan zone.
  const merges = (worksheet['!merges'] ?? []) as Array<{
    e: { c: number; r: number };
    s: { c: number; r: number };
  }>;
  for (const range of merges) {
    if (!range?.s || !range?.e) continue;
    if (range.s.r >= maxHeaderRows || range.e.r >= maxHeaderRows) continue;
    const src = headerMatrix[range.s.r]?.[range.s.c] ?? '';
    if (!src) continue;
    for (let r = range.s.r; r <= range.e.r && r < headerMatrix.length; r++) {
      for (let c = range.s.c; c <= range.e.c && c < colCount; c++) {
        if (!headerMatrix[r]![c]) headerMatrix[r]![c] = src;
      }
    }
  }

  // Horizontal fill only within header scan rows (for multi-level labels).
  for (let r = 0; r < headerMatrix.length; r++) {
    headerMatrix[r] = fillMergedRow(headerMatrix[r]!);
  }

  let bestDepth = 1;
  let bestScore = scoreHeaderDepth(headerMatrix, 1, colCount);
  const topLabels = headerMatrix[0]?.map((c) => c.trim()).filter(Boolean) ?? [];
  for (let d = 2; d <= headerMatrix.length; d++) {
    // Do not consume a row that looks like data as a second header layer.
    const candidate = headerMatrix[d - 1] ?? [];
    if (looksLikeDataRow(candidate, topLabels)) break;
    const score = scoreHeaderDepth(headerMatrix, d, colCount);
    // Require a clear improvement over single-row headers (multi-level only when worth it).
    if (score > bestScore + 2) {
      bestScore = score;
      bestDepth = d;
    }
  }

  const rawNames: string[] = [];
  for (let c = 0; c < colCount; c++) {
    const parts: string[] = [];
    for (let r = 0; r < bestDepth; r++) {
      const cell = headerMatrix[r]?.[c]?.trim() ?? '';
      if (cell && !isEmptyLikeHeader(cell) && parts.at(-1) !== cell) parts.push(cell);
    }
    rawNames.push(parts.join(' / '));
  }

  const columns = dedupeColumnNames(rawNames);
  const rows: Record<string, string>[] = [];
  // Data from pristine matrix — empty cells stay empty.
  for (let r = bestDepth; r < dataMatrix.length; r++) {
    const line = dataMatrix[r]!;
    if (line.every((c) => !c.trim())) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < columns.length; c++) {
      obj[columns[c]!] = cellToString(line[c], maxCellChars);
    }
    rows.push(obj);
  }

  return { columns, headerRowCount: bestDepth, rows };
}
