import * as xlsx from 'xlsx';

/** Preview caps so a huge 词库 does not freeze the tab. */
export const SPREADSHEET_PREVIEW_MAX_ROWS = 500;
export const SPREADSHEET_PREVIEW_MAX_COLS = 40;

export interface SpreadsheetSheetPreview {
  /** First row, used as sticky header when present. */
  headers: string[];
  name: string;
  /** Data rows after the header, already sliced to preview caps. */
  rows: string[][];
  totalCols: number;
  /** Total data rows excluding the header row. */
  totalRows: number;
}

const cellText = (value: unknown): string => (value == null ? '' : String(value));

export const parseSpreadsheetBuffer = (
  data: ArrayBuffer | Uint8Array,
): SpreadsheetSheetPreview[] => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const workbook = xlsx.read(bytes, { type: 'array' });

  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const grid = xlsx.utils.sheet_to_json<unknown[]>(worksheet, {
      defval: '',
      header: 1,
      raw: false,
    });

    const totalCols = grid.reduce(
      (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
      0,
    );
    const colCount = Math.min(totalCols, SPREADSHEET_PREVIEW_MAX_COLS);
    const padded = grid.map((row) => {
      const cells = Array.isArray(row) ? row : [];
      return Array.from({ length: colCount }, (_, index) => cellText(cells[index]));
    });

    const headers = padded[0] ?? [];
    const body = padded.slice(1, 1 + SPREADSHEET_PREVIEW_MAX_ROWS);

    return {
      headers,
      name,
      rows: body,
      totalCols,
      totalRows: Math.max(0, padded.length - 1),
    };
  });
};
