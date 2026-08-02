import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import type { SheetQueryFilter, SheetQueryInput, SheetQueryResult } from './querySheet';
import {
  applySheetCharBudget,
  queryJsonlSheet,
  SHEET_QUERY_DEFAULT_LIMIT,
  SHEET_QUERY_MAX_LIMIT,
  SHEET_QUERY_MAX_SCAN,
} from './querySheet';

/** Sheets at/above this size prefer parquet storage when DuckDB is available. */
export const WORKBOOK_PARQUET_THRESHOLD_BYTES = 512 * 1024;

type DuckConn = {
  run: (sql: string, ...params: unknown[]) => Promise<unknown>;
  runAndReadAll: (
    sql: string,
    ...params: unknown[]
  ) => Promise<{ getRowObjectsJS: () => Record<string, unknown>[] }>;
  closeSync?: () => void;
};

type DuckInstance = {
  connect: () => DuckConn | Promise<DuckConn>;
  closeSync?: () => void;
};

let duckdbLoadAttempted = false;
let duckdbOk = false;
let DuckDBInstanceCreate: ((path?: string) => Promise<DuckInstance>) | null = null;

/**
 * Lazy-load @duckdb/node-api. Returns false when native module is unavailable
 * (distroless without binary, tests without optional dep).
 */
export async function isDuckDBAvailable(): Promise<boolean> {
  if (duckdbLoadAttempted) return duckdbOk;
  duckdbLoadAttempted = true;
  try {
    const mod = await import('@duckdb/node-api');
    const DuckDBInstance = (
      mod as { DuckDBInstance?: { create: (path?: string) => Promise<DuckInstance> } }
    ).DuckDBInstance;
    if (!DuckDBInstance?.create) {
      duckdbOk = false;
      return false;
    }
    DuckDBInstanceCreate = DuckDBInstance.create.bind(DuckDBInstance);
    const db = await DuckDBInstanceCreate(':memory:');
    db.closeSync?.();
    duckdbOk = true;
    return true;
  } catch {
    duckdbOk = false;
    DuckDBInstanceCreate = null;
    return false;
  }
}

async function openDuck(): Promise<DuckInstance | null> {
  if (!(await isDuckDBAvailable()) || !DuckDBInstanceCreate) return null;
  try {
    return await DuckDBInstanceCreate(':memory:');
  } catch {
    return null;
  }
}

/**
 * Convert a JSONL file on disk → parquet bytes via DuckDB (no full JSONL string in JS).
 */
export async function jsonlFileToParquetBuffer(jsonlPath: string): Promise<Buffer | null> {
  const db = await openDuck();
  if (!db) return null;

  const dir = await mkdtemp(path.join(tmpdir(), 'wb-parquet-'));
  const parquetPath = path.join(dir, 'sheet.parquet');
  try {
    const conn = await Promise.resolve(db.connect());
    const j = jsonlPath.replaceAll("'", "''");
    const p = parquetPath.replaceAll("'", "''");
    await conn.run(
      `COPY (SELECT * FROM read_json_auto('${j}', format='newline_delimited', ignore_errors=true)) TO '${p}' (FORMAT PARQUET)`,
    );
    conn.closeSync?.();
    db.closeSync?.();
    return await readFile(parquetPath);
  } catch {
    try {
      db.closeSync?.();
    } catch {
      /* ignore */
    }
    return null;
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => undefined);
  }
}

/**
 * Convert JSONL text → parquet bytes via DuckDB.
 * Returns null if DuckDB unavailable or conversion fails.
 */
export async function jsonlToParquetBuffer(
  jsonl: string,
  _columns: string[],
): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wb-jsonl-pq-'));
  const jsonlPath = path.join(dir, 'sheet.jsonl');
  try {
    await writeFile(jsonlPath, jsonl.endsWith('\n') ? jsonl : `${jsonl}\n`, 'utf8');
    return await jsonlFileToParquetBuffer(jsonlPath);
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => undefined);
  }
}

const sqlLiteral = (value: string | number | boolean | null): string => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replaceAll("'", "''")}'`;
};

const buildWhere = (filters?: SheetQueryFilter[]): string => {
  if (!filters?.length) return '';
  const parts: string[] = [];
  for (const f of filters) {
    const col = `"${f.column.replaceAll('"', '""')}"`;
    const op = f.op ?? 'eq';
    if (op === 'contains') {
      parts.push(
        `lower(CAST(${col} AS VARCHAR)) LIKE ${sqlLiteral(`%${String(f.value ?? '').toLowerCase()}%`)}`,
      );
      continue;
    }
    if (op === 'eq') {
      parts.push(`CAST(${col} AS VARCHAR) = ${sqlLiteral(String(f.value ?? ''))}`);
      continue;
    }
    const n = Number(f.value);
    if (!Number.isFinite(n)) continue;
    if (op === 'gt') parts.push(`TRY_CAST(${col} AS DOUBLE) > ${n}`);
    if (op === 'gte') parts.push(`TRY_CAST(${col} AS DOUBLE) >= ${n}`);
    if (op === 'lt') parts.push(`TRY_CAST(${col} AS DOUBLE) < ${n}`);
    if (op === 'lte') parts.push(`TRY_CAST(${col} AS DOUBLE) <= ${n}`);
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
};

/**
 * Query a parquet file on disk with DuckDB. Returns null so caller can fall back.
 */
export async function queryParquetFile(
  parquetPath: string,
  input: SheetQueryInput = {},
): Promise<SheetQueryResult | null> {
  const db = await openDuck();
  if (!db) return null;

  const limit = Math.min(
    Math.max(1, input.limit ?? SHEET_QUERY_DEFAULT_LIMIT),
    SHEET_QUERY_MAX_LIMIT,
  );
  const offset = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
  const where = buildWhere(input.filters);
  const order = input.orderBy?.[0]
    ? `ORDER BY "${input.orderBy[0].column.replaceAll('"', '""')}" ${
        input.orderBy[0].direction === 'desc' ? 'DESC' : 'ASC'
      }`
    : '';
  const cols = input.columns?.length
    ? input.columns.map((c) => `"${c.replaceAll('"', '""')}"`).join(', ')
    : '*';
  const pathLit = parquetPath.replaceAll("'", "''");

  try {
    const conn = await Promise.resolve(db.connect());
    const countRows = await conn.runAndReadAll(
      `SELECT count(*)::BIGINT AS n FROM read_parquet('${pathLit}') ${where}`,
    );
    const totalRows = Number(countRows.getRowObjectsJS()[0]?.n ?? 0);

    const data = await conn.runAndReadAll(
      `SELECT ${cols} FROM read_parquet('${pathLit}') ${where} ${order} LIMIT ${limit} OFFSET ${offset}`,
    );
    conn.closeSync?.();
    db.closeSync?.();

    const raw = data.getRowObjectsJS().map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v == null ? '' : String(v);
      return out;
    });

    const { rows: page, truncated: charTruncated } = applySheetCharBudget(raw);
    const nextOffset = offset + page.length;
    const more = nextOffset < totalRows && page.length > 0;
    return {
      nextCursor: more || charTruncated ? String(offset + page.length) : undefined,
      returnedRows: page.length,
      rows: page,
      scannedRows: Math.min(totalRows, SHEET_QUERY_MAX_SCAN, offset + page.length),
      totalRows,
      truncated: more || charTruncated,
    };
  } catch (err) {
    try {
      db.closeSync?.();
    } catch {
      /* ignore */
    }
    // Re-throw ReferenceError / programming errors so tests surface them; I/O/SQL → null fallback.
    if (err instanceof ReferenceError || err instanceof TypeError) throw err;
    return null;
  }
}

/** Materialize parquet bytes to a temp file, query, cleanup. */
export async function queryParquetBuffer(
  parquet: Buffer,
  input: SheetQueryInput = {},
): Promise<SheetQueryResult | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wb-pq-q-'));
  const filePath = path.join(dir, 'sheet.parquet');
  try {
    await writeFile(filePath, parquet);
    return await queryParquetFile(filePath, input);
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => undefined);
  }
}

/**
 * Line-stream JSONL query from a file path (does not load whole file as one string).
 * orderBy still buffers matched rows up to SHEET_QUERY_MAX_SCAN.
 */
export async function queryJsonlFile(
  filePath: string,
  input: SheetQueryInput = {},
): Promise<SheetQueryResult> {
  const orderBy = input.orderBy?.[0];
  if (orderBy) {
    const lines: string[] = [];
    let totalRows = 0;
    const rl = createInterface({ crlfDelay: Infinity, input: createReadStream(filePath, 'utf8') });
    for await (const line of rl) {
      totalRows++;
      if (lines.length < SHEET_QUERY_MAX_SCAN) lines.push(line);
    }
    const result = queryJsonlSheet(lines.join('\n'), input);
    return {
      ...result,
      coverageLimited: totalRows > SHEET_QUERY_MAX_SCAN || result.coverageLimited,
      totalRows,
      truncated: result.truncated || totalRows > SHEET_QUERY_MAX_SCAN,
    };
  }

  const limit = Math.min(
    Math.max(1, input.limit ?? SHEET_QUERY_DEFAULT_LIMIT),
    SHEET_QUERY_MAX_LIMIT,
  );
  const start = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
  const matched: { row: Record<string, string>; sourceIndex: number }[] = [];
  let scanned = 0;
  let totalRows = 0;
  let scanEnd = start;
  let pageFull = false;

  const rl = createInterface({ crlfDelay: Infinity, input: createReadStream(filePath, 'utf8') });
  let i = -1;
  for await (const line of rl) {
    i++;
    totalRows++;
    if (pageFull) continue;
    if (i < start) continue;
    if (scanned >= SHEET_QUERY_MAX_SCAN || matched.length >= limit) {
      pageFull = matched.length >= limit || scanned >= SHEET_QUERY_MAX_SCAN;
      if (pageFull) continue;
    }
    scanned++;
    scanEnd = i + 1;
    if (!line) continue;
    let row: Record<string, string>;
    try {
      row = JSON.parse(line) as Record<string, string>;
    } catch {
      continue;
    }
    if (input.filters?.length) {
      const ok = input.filters.every((f) => {
        const raw = row[f.column] ?? '';
        const op = f.op ?? 'eq';
        if (op === 'contains')
          return raw.toLowerCase().includes(String(f.value ?? '').toLowerCase());
        if (op === 'eq') return raw === String(f.value ?? '');
        const left = Number(raw);
        const right = Number(f.value);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
        if (op === 'gt') return left > right;
        if (op === 'gte') return left >= right;
        if (op === 'lt') return left < right;
        if (op === 'lte') return left <= right;
        return false;
      });
      if (!ok) continue;
    }
    const projected = input.columns?.length
      ? Object.fromEntries(input.columns.map((c) => [c, row[c] ?? '']))
      : row;
    matched.push({ row: projected, sourceIndex: i });
    if (matched.length >= limit) pageFull = true;
  }

  const rawRows = matched.map((m) => m.row);
  const { rows: page, truncated: charTruncated } = applySheetCharBudget(rawRows);
  const kept = matched.slice(0, page.length);
  const last = kept.at(-1);
  const nextCursorIndex = last !== undefined ? last.sourceIndex + 1 : scanEnd;
  const hasMore = nextCursorIndex < totalRows;
  return {
    nextCursor: hasMore || charTruncated ? String(nextCursorIndex) : undefined,
    returnedRows: page.length,
    rows: page,
    scannedRows: scanned,
    totalRows,
    truncated: hasMore || charTruncated,
  };
}
