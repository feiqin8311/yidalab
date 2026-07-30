import { readFile, stat } from 'node:fs/promises';

import * as xlsx from 'xlsx';

/** Parser version for idempotent workbook rebuilds. Bump when output shape changes. */
export const WORKBOOK_PARSER_VERSION = 'workbook-v1';

/**
 * Hard platform limits for one parse job.
 * XLSX materialize runs in a child process (see workbookParseIsolate); caps still apply.
 */
export const WORKBOOK_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const WORKBOOK_MAX_FILE_BYTES_HARD = WORKBOOK_MAX_FILE_BYTES;
export const WORKBOOK_MAX_SHEETS = 80;
export const WORKBOOK_MAX_COLUMNS = 200;
export const WORKBOOK_MAX_CELL_CHARS = 2_000;
export const WORKBOOK_MAX_ROWS_PER_SHEET = 200_000;
export const WORKBOOK_MAX_TOTAL_CELLS = 2_000_000;
/** Total derived JSONL payload across all sheets (bytes). */
export const WORKBOOK_MAX_TOTAL_JSONL_BYTES = 64 * 1024 * 1024;
export const WORKBOOK_INLINE_JSONL_MAX_BYTES = 512 * 1024;
/** Prefer parquet when sheet JSONL exceeds this and DuckDB is available. */
export const WORKBOOK_PARQUET_MIN_BYTES = 512 * 1024;
export const WORKBOOK_SAMPLE_ROWS = 5;
export const WORKBOOK_CARD_SAMPLE_ROWS = 3;
/** In-process concurrent parse slots (fallback path / tests). */
export const WORKBOOK_PARSE_CONCURRENCY = 1;

export interface WorkbookSheetAssetBuild {
  columnCount: number;
  columns: string[];
  jsonl: string;
  rowCount: number;
  sampleRows: Record<string, string>[];
  sheetIndex: number;
  sheetName: string;
}

export interface WorkbookCoverage {
  columnsCapped: boolean;
  sheetsCapped: boolean;
  sourceSheetCount: number;
}

export interface WorkbookAssetBuild {
  coverage: WorkbookCoverage;
  parserVersion: string;
  sheetCount: number;
  sheets: WorkbookSheetAssetBuild[];
  totalJsonlBytes: number;
  totalRows: number;
  unrestrictedTokenEstimate: number;
}

const cellToString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.length <= WORKBOOK_MAX_CELL_CHARS) return text;
  return `${text.slice(0, WORKBOOK_MAX_CELL_CHARS)}…`;
};

const normalizeRow = (row: Record<string, unknown>, columns: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const col of columns) {
    out[col] = cellToString(row[col]);
  }
  return out;
};

const estimateSheetCells = (worksheet: xlsx.WorkSheet): number => {
  const ref = worksheet['!ref'];
  if (!ref) return 0;
  try {
    const range = xlsx.utils.decode_range(ref);
    const rows = Math.max(0, range.e.r - range.s.r + 1);
    const cols = Math.max(0, range.e.c - range.s.c + 1);
    return rows * cols;
  } catch {
    return 0;
  }
};

/** Process-wide parse mutex queue (ponytail: single-flight concurrency). */
let parseSlots = WORKBOOK_PARSE_CONCURRENCY;
const parseWaiters: Array<() => void> = [];

export async function withWorkbookParseSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (parseSlots <= 0) {
    await new Promise<void>((resolve) => parseWaiters.push(resolve));
  }
  parseSlots--;
  try {
    return await fn();
  } finally {
    parseSlots++;
    const next = parseWaiters.shift();
    if (next) next();
  }
}

/**
 * One-shot structured parse. Prefer `buildWorkbookAssetsIsolated` in server workers
 * so timeout can SIGKILL the child. This entry uses an in-process slot mutex.
 */
export async function buildWorkbookAssetsFromPath(filePath: string): Promise<WorkbookAssetBuild> {
  return withWorkbookParseSlot(() => buildWorkbookAssetsFromPathUnlocked(filePath));
}

/** Unlocked in-process parse (tests + isolate fallback). */
export async function buildWorkbookAssetsFromPathUnlocked(
  filePath: string,
): Promise<WorkbookAssetBuild> {
  const fileStat = await stat(filePath);
  if (fileStat.size > WORKBOOK_MAX_FILE_BYTES_HARD) {
    throw new Error(
      `Workbook exceeds platform size limit (${WORKBOOK_MAX_FILE_BYTES_HARD} bytes, on-disk ${fileStat.size})`,
    );
  }

  const dataBuffer = await readFile(filePath);
  if (dataBuffer.byteLength > WORKBOOK_MAX_FILE_BYTES) {
    throw new Error(`Workbook exceeds platform size limit (${WORKBOOK_MAX_FILE_BYTES} bytes)`);
  }

  const workbook = xlsx.read(dataBuffer, {
    type: 'buffer',
    cellDates: true,
    dense: false,
  });
  const sourceSheetCount = workbook.SheetNames.length;
  const sheetsCapped = sourceSheetCount > WORKBOOK_MAX_SHEETS;
  const sheetNames = workbook.SheetNames.slice(0, WORKBOOK_MAX_SHEETS);
  const sheets: WorkbookSheetAssetBuild[] = [];
  let totalRows = 0;
  let totalCells = 0;
  let totalJsonlBytes = 0;
  let unrestrictedChars = 0;
  let columnsCapped = false;

  let estimatedCells = 0;
  for (const name of sheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    estimatedCells += estimateSheetCells(ws);
    if (estimatedCells > WORKBOOK_MAX_TOTAL_CELLS) {
      throw new Error(
        `Workbook sheet ranges exceed max cells (${WORKBOOK_MAX_TOTAL_CELLS}); reject before materialize`,
      );
    }
  }

  for (let sheetIndex = 0; sheetIndex < sheetNames.length; sheetIndex++) {
    const sheetName = sheetNames[sheetIndex]!;
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const sheetEstimate = estimateSheetCells(worksheet);
    if (sheetEstimate > WORKBOOK_MAX_ROWS_PER_SHEET * WORKBOOK_MAX_COLUMNS) {
      throw new Error(
        `Sheet "${sheetName}" range too large (~${sheetEstimate} cells); use a smaller export`,
      );
    }

    const jsonData = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: '',
      raw: false,
    });

    const allHeaderKeys =
      jsonData.length > 0
        ? Object.keys(jsonData[0] || {})
        : (xlsx.utils
            .sheet_to_json<string[]>(worksheet, { header: 1, defval: '' })[0]
            ?.map((h) => String(h ?? '').trim())
            .filter(Boolean) ?? []);

    if (allHeaderKeys.length > WORKBOOK_MAX_COLUMNS) columnsCapped = true;
    const headerKeys = allHeaderKeys.slice(0, WORKBOOK_MAX_COLUMNS);

    const columns =
      headerKeys.length > 0
        ? headerKeys.map((h, i) => String(h).trim() || `col_${i + 1}`)
        : ['col_1'];

    if (jsonData.length > WORKBOOK_MAX_ROWS_PER_SHEET) {
      throw new Error(`Sheet "${sheetName}" exceeds max rows (${WORKBOOK_MAX_ROWS_PER_SHEET})`);
    }

    totalCells += jsonData.length * columns.length;
    if (totalCells > WORKBOOK_MAX_TOTAL_CELLS) {
      throw new Error(`Workbook exceeds max cells (${WORKBOOK_MAX_TOTAL_CELLS})`);
    }

    const lines: string[] = [];
    const sampleRows: Record<string, string>[] = [];
    for (let i = 0; i < jsonData.length; i++) {
      const normalized = normalizeRow(jsonData[i]!, columns);
      const line = JSON.stringify(normalized);
      lines.push(line);
      totalJsonlBytes += Buffer.byteLength(line, 'utf8') + (i > 0 ? 1 : 0);
      if (totalJsonlBytes > WORKBOOK_MAX_TOTAL_JSONL_BYTES) {
        throw new Error(
          `Derived JSONL exceeds platform limit (${WORKBOOK_MAX_TOTAL_JSONL_BYTES} bytes)`,
        );
      }
      if (sampleRows.length < WORKBOOK_SAMPLE_ROWS) sampleRows.push(normalized);
      unrestrictedChars += columns.reduce((sum, c) => sum + (normalized[c]?.length ?? 0) + 3, 20);
    }

    const jsonl = lines.join('\n');
    totalRows += jsonData.length;
    sheets.push({
      columnCount: columns.length,
      columns,
      jsonl,
      rowCount: jsonData.length,
      sampleRows,
      sheetIndex,
      sheetName,
    });
  }

  return {
    coverage: {
      columnsCapped,
      sheetsCapped,
      sourceSheetCount,
    },
    parserVersion: WORKBOOK_PARSER_VERSION,
    sheetCount: sheets.length,
    sheets,
    totalJsonlBytes,
    totalRows,
    unrestrictedTokenEstimate: Math.ceil(unrestrictedChars / 4),
  };
}

export const isSpreadsheetFile = (fileType: string, name?: string): boolean => {
  const mime = (fileType || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return true;
  }
  return lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.xlsm');
};
