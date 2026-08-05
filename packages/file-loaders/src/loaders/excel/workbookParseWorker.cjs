/**
 * Child-process workbook parse worker.
 * Usage: node workbookParseWorker.cjs <filePath> <outDir>
 *
 * Writes per-sheet JSONL under outDir; IPC returns metadata + samples only
 * (never multi-MB sheet bodies over the IPC channel).
 * Must wait for process.send callback before exit.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CJS worker for child_process.fork */
'use strict';

const { mkdir, readFile, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');

const WORKBOOK_PARSER_VERSION = 'workbook-v1';
const WORKBOOK_MAX_FILE_BYTES = 20 * 1024 * 1024;
const WORKBOOK_MAX_SHEETS = 80;
const WORKBOOK_MAX_COLUMNS = 200;
const WORKBOOK_MAX_CELL_CHARS = 2_000;
const WORKBOOK_MAX_ROWS_PER_SHEET = 200_000;
const WORKBOOK_MAX_TOTAL_CELLS = 2_000_000;
const WORKBOOK_MAX_TOTAL_JSONL_BYTES = 64 * 1024 * 1024;
const WORKBOOK_SAMPLE_ROWS = 5;

const cellToString = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.length <= WORKBOOK_MAX_CELL_CHARS) return text;
  return `${text.slice(0, WORKBOOK_MAX_CELL_CHARS)}…`;
};

const normalizeRow = (row, columns) => {
  const out = {};
  for (const col of columns) out[col] = cellToString(row[col]);
  return out;
};

const estimateSheetCells = (worksheet, xlsx) => {
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

const resolveXlsx = () => {
  const candidates = [
    () => require('xlsx'),
    // Docker standalone: deps copied to /app/node_modules/xlsx
    () => require('/app/node_modules/xlsx'),
    () => require(path.join(process.cwd(), 'node_modules', 'xlsx')),
    // monorepo dev: next to this worker under packages/file-loaders
    () =>
      require(path.join(path.dirname(__filename), '..', '..', '..', '..', 'node_modules', 'xlsx')),
  ];
  const errors = [];
  for (const load of candidates) {
    try {
      return load();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`xlsx module not found in parse worker: ${errors.join(' | ')}`);
};

/** Wait until IPC flush completes (or stdout write for non-IPC). */
const send = (payload) =>
  new Promise((resolve) => {
    if (typeof process.send === 'function') {
      process.send(payload, (err) => {
        // err only if channel closed; still resolve so we can exit
        if (err) {
          try {
            process.stderr.write(`process.send failed: ${err.message}\n`);
          } catch {
            /* ignore */
          }
        }
        resolve();
      });
      return;
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`, () => resolve());
  });

async function build(filePath, outDir) {
  const xlsx = resolveXlsx();
  await mkdir(outDir, { recursive: true });

  const fileStat = await stat(filePath);
  if (fileStat.size > WORKBOOK_MAX_FILE_BYTES) {
    throw new Error(
      `Workbook exceeds platform size limit (${WORKBOOK_MAX_FILE_BYTES} bytes, on-disk ${fileStat.size})`,
    );
  }

  const dataBuffer = await readFile(filePath);
  if (dataBuffer.byteLength > WORKBOOK_MAX_FILE_BYTES) {
    throw new Error(`Workbook exceeds platform size limit (${WORKBOOK_MAX_FILE_BYTES} bytes)`);
  }

  const workbook = xlsx.read(dataBuffer, { type: 'buffer', cellDates: true, dense: false });
  const sourceSheetCount = workbook.SheetNames.length;
  const sheetsCapped = sourceSheetCount > WORKBOOK_MAX_SHEETS;
  const sheetNames = workbook.SheetNames.slice(0, WORKBOOK_MAX_SHEETS);
  const sheets = [];
  let totalRows = 0;
  let totalCells = 0;
  let totalJsonlBytes = 0;
  let unrestrictedChars = 0;
  let columnsCapped = false;

  let estimatedCells = 0;
  for (const name of sheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    estimatedCells += estimateSheetCells(ws, xlsx);
    if (estimatedCells > WORKBOOK_MAX_TOTAL_CELLS) {
      throw new Error(
        `Workbook sheet ranges exceed max cells (${WORKBOOK_MAX_TOTAL_CELLS}); reject before materialize`,
      );
    }
  }

  for (let sheetIndex = 0; sheetIndex < sheetNames.length; sheetIndex++) {
    const sheetName = sheetNames[sheetIndex];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const sheetEstimate = estimateSheetCells(worksheet, xlsx);
    if (sheetEstimate > WORKBOOK_MAX_ROWS_PER_SHEET * WORKBOOK_MAX_COLUMNS) {
      throw new Error(
        `Sheet "${sheetName}" range too large (~${sheetEstimate} cells); use a smaller export`,
      );
    }

    // Multi-level header normalization (avoid SheetJS __EMPTY_* keys).
    // Data rows use pristine matrix — never horizontal-filled.
    const HEADER_SCAN_MAX_ROWS = 5;
    const matrixRaw = xlsx.utils.sheet_to_json(worksheet, {
      defval: '',
      header: 1,
      raw: false,
    });
    const colCount = Math.min(
      WORKBOOK_MAX_COLUMNS,
      matrixRaw.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0) || 1,
    );
    if (colCount >= WORKBOOK_MAX_COLUMNS) columnsCapped = true;
    const dataMatrix = matrixRaw.map((row) => {
      const arr = Array.isArray(row) ? row : [];
      const out = [];
      for (let c = 0; c < colCount; c++) out.push(cellToString(arr[c]).trim());
      return out;
    });
    const headerMatrix = dataMatrix
      .slice(0, Math.min(HEADER_SCAN_MAX_ROWS, dataMatrix.length))
      .map((r) => [...r]);
    const merges = worksheet['!merges'] || [];
    for (const range of merges) {
      if (!range?.s || !range?.e) continue;
      // Only fill merges fully inside header scan zone (never into data rows).
      if (range.s.r >= HEADER_SCAN_MAX_ROWS || range.e.r >= HEADER_SCAN_MAX_ROWS) continue;
      const src = headerMatrix[range.s.r]?.[range.s.c] || '';
      if (!src) continue;
      for (let r = range.s.r; r <= range.e.r && r < headerMatrix.length; r++) {
        for (let c = range.s.c; c <= range.e.c && c < colCount; c++) {
          if (!headerMatrix[r][c]) headerMatrix[r][c] = src;
        }
      }
    }
    const fillMergedRow = (row) => {
      const out = [...row];
      let last = '';
      for (let i = 0; i < out.length; i++) {
        const v = (out[i] || '').trim();
        if (v && !/^__EMPTY(?:_\d+)?$/i.test(v)) {
          last = v;
          out[i] = v;
        } else if (last) out[i] = last;
        else out[i] = '';
      }
      return out;
    };
    for (let r = 0; r < headerMatrix.length; r++)
      headerMatrix[r] = fillMergedRow(headerMatrix[r] || []);
    const scoreDepth = (depth) => {
      let nonEmpty = 0;
      let unique = 0;
      let numericish = 0;
      const seen = new Set();
      for (let c = 0; c < colCount; c++) {
        const parts = [];
        for (let r = 0; r < depth; r++) {
          const cell = (headerMatrix[r]?.[c] || '').trim();
          if (cell && !/^__EMPTY(?:_\d+)?$/i.test(cell)) parts.push(cell);
        }
        const label = parts.join(' / ');
        if (label) {
          nonEmpty++;
          if (!seen.has(label)) {
            seen.add(label);
            unique++;
          }
          if (/^-?\d+(?:\.\d+)?$/.test(label) || /\/\s*-?\d+(?:\.\d+)?$/.test(label)) numericish++;
        }
      }
      return nonEmpty * 3 + unique * 2 - numericish * 8 - (depth - 1);
    };
    let bestDepth = 1;
    let bestScore = -Infinity;
    for (let d = 1; d <= headerMatrix.length; d++) {
      const s = scoreDepth(d);
      if (s > bestScore) {
        bestScore = s;
        bestDepth = d;
      }
    }
    const rawNames = [];
    for (let c = 0; c < colCount; c++) {
      const parts = [];
      for (let r = 0; r < bestDepth; r++) {
        const cell = (headerMatrix[r]?.[c] || '').trim();
        if (cell && !/^__EMPTY(?:_\d+)?$/i.test(cell) && parts.at(-1) !== cell) {
          parts.push(cell);
        }
      }
      rawNames.push(parts.join(' / ') || `col_${c + 1}`);
    }
    const seenNames = new Map();
    const columns = rawNames.map((raw, i) => {
      let base = (raw || '').trim() || `col_${i + 1}`;
      if (/^__EMPTY(?:_\d+)?$/i.test(base)) base = `col_${i + 1}`;
      const count = seenNames.get(base) || 0;
      seenNames.set(base, count + 1);
      return count === 0 ? base : `${base}_${count + 1}`;
    });
    const jsonData = [];
    for (let r = bestDepth; r < dataMatrix.length; r++) {
      const line = dataMatrix[r] || [];
      if (line.every((c) => !String(c || '').trim())) continue;
      const obj = {};
      for (let c = 0; c < columns.length; c++) obj[columns[c]] = cellToString(line[c]);
      jsonData.push(obj);
    }

    if (jsonData.length > WORKBOOK_MAX_ROWS_PER_SHEET) {
      throw new Error(`Sheet "${sheetName}" exceeds max rows (${WORKBOOK_MAX_ROWS_PER_SHEET})`);
    }

    totalCells += jsonData.length * columns.length;
    if (totalCells > WORKBOOK_MAX_TOTAL_CELLS) {
      throw new Error(`Workbook exceeds max cells (${WORKBOOK_MAX_TOTAL_CELLS})`);
    }

    const sampleRows = [];
    const jsonlPath = path.join(outDir, `sheet-${sheetIndex}.jsonl`);
    // Stream-ish write: build lines in memory still, but keep off IPC.
    // For very large sheets this is still the parent of OOM risk — caps above apply.
    const lineBuf = [];
    let sheetBytes = 0;
    for (let i = 0; i < jsonData.length; i++) {
      const normalized = normalizeRow(jsonData[i], columns);
      const line = JSON.stringify(normalized);
      lineBuf.push(line);
      sheetBytes += Buffer.byteLength(line, 'utf8') + (i > 0 ? 1 : 0);
      totalJsonlBytes += Buffer.byteLength(line, 'utf8') + (i > 0 ? 1 : 0);
      if (totalJsonlBytes > WORKBOOK_MAX_TOTAL_JSONL_BYTES) {
        throw new Error(
          `Derived JSONL exceeds platform limit (${WORKBOOK_MAX_TOTAL_JSONL_BYTES} bytes)`,
        );
      }
      if (sampleRows.length < WORKBOOK_SAMPLE_ROWS) sampleRows.push(normalized);
      unrestrictedChars += columns.reduce((sum, c) => sum + (normalized[c]?.length ?? 0) + 3, 20);
    }
    await writeFile(jsonlPath, lineBuf.join('\n'), 'utf8');

    totalRows += jsonData.length;
    sheets.push({
      columnCount: columns.length,
      columns,
      jsonlBytes: sheetBytes,
      jsonlPath,
      rowCount: jsonData.length,
      sampleRows,
      sheetIndex,
      sheetName,
    });
  }

  return {
    coverage: { columnsCapped, sheetsCapped, sourceSheetCount },
    outDir,
    parserVersion: WORKBOOK_PARSER_VERSION,
    sheetCount: sheets.length,
    sheets,
    totalJsonlBytes,
    totalRows,
    unrestrictedTokenEstimate: Math.ceil(unrestrictedChars / 4),
  };
}

const main = async () => {
  const filePath = process.argv[2];
  const outDir = process.argv[3];
  if (!filePath || !outDir) {
    await send({ ok: false, error: 'Usage: workbookParseWorker.cjs <filePath> <outDir>' });
    process.exitCode = 2;
    return;
  }
  try {
    const result = await build(filePath, outDir);
    await send({ ok: true, result });
    process.exitCode = 0;
  } catch (e) {
    await send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  }
};

main().catch(async (e) => {
  await send({ ok: false, error: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
});
