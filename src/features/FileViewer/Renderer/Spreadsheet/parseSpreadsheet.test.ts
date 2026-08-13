import { describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';

import {
  parseSpreadsheetBuffer,
  SPREADSHEET_PREVIEW_MAX_COLS,
  SPREADSHEET_PREVIEW_MAX_ROWS,
} from './parseSpreadsheet';

const toBytes = (workbook: xlsx.WorkBook) =>
  new Uint8Array(xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer);

describe('parseSpreadsheetBuffer', () => {
  it('keeps sheet names, headers, and rows for a typical workbook', () => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet([
        ['ASIN', 'Sales'],
        ['B01', 12],
        ['B02', 34],
      ]),
      'Campaigns',
    );
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['only']]), 'Emptyish');

    const sheets = parseSpreadsheetBuffer(toBytes(workbook));

    expect(sheets.map((sheet) => sheet.name)).toEqual(['Campaigns', 'Emptyish']);
    expect(sheets[0]).toMatchObject({
      headers: ['ASIN', 'Sales'],
      rows: [
        ['B01', '12'],
        ['B02', '34'],
      ],
      totalCols: 2,
      totalRows: 2,
    });
  });

  it('caps oversized sheets so preview stays usable', () => {
    const header = Array.from({ length: SPREADSHEET_PREVIEW_MAX_COLS + 5 }, (_, i) => `c${i}`);
    const rows = Array.from({ length: SPREADSHEET_PREVIEW_MAX_ROWS + 8 }, (_, r) =>
      header.map((_, c) => `${r}-${c}`),
    );
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([header, ...rows]), 'Big');

    const [sheet] = parseSpreadsheetBuffer(toBytes(workbook));

    expect(sheet.headers).toHaveLength(SPREADSHEET_PREVIEW_MAX_COLS);
    expect(sheet.rows).toHaveLength(SPREADSHEET_PREVIEW_MAX_ROWS);
    expect(sheet.totalRows).toBe(SPREADSHEET_PREVIEW_MAX_ROWS + 8);
    expect(sheet.totalCols).toBe(SPREADSHEET_PREVIEW_MAX_COLS + 5);
  });
});
