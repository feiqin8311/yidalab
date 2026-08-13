import { describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';

import { parseSpreadsheetBuffer } from './parseSpreadsheet';

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

  it('keeps rows and columns beyond the previous preview limits', () => {
    const header = Array.from({ length: 45 }, (_, index) => `c${index}`);
    const rows = Array.from({ length: 508 }, (_, rowIndex) =>
      header.map((_, columnIndex) => `${rowIndex}-${columnIndex}`),
    );
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([header, ...rows]), 'Big');

    const [sheet] = parseSpreadsheetBuffer(toBytes(workbook));

    expect(sheet.headers).toHaveLength(45);
    expect(sheet.rows).toHaveLength(508);
    expect(sheet.rows.at(-1)?.at(-1)).toBe('507-44');
    expect(sheet.totalRows).toBe(508);
    expect(sheet.totalCols).toBe(45);
  });
});
