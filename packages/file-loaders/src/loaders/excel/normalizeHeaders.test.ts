import { describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';

import { normalizeWorksheetTable } from './normalizeHeaders';

describe('normalizeWorksheetTable', () => {
  it('uses single-row headers without __EMPTY', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['花费', 'ROAS', '销售额'],
      [100, 2.5, 250],
      [200, 1.8, 360],
    ]);
    const table = normalizeWorksheetTable(ws);
    expect(table.columns).toEqual(['花费', 'ROAS', '销售额']);
    expect(table.headerRowCount).toBe(1);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toMatchObject({ 花费: '100', ROAS: '2.5', 销售额: '250' });
    expect(table.columns.some((c) => /__EMPTY/i.test(c))).toBe(false);
  });

  it('merges multi-level headers with /', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['广告数据', '', '订单数据', ''],
      ['花费', 'ROAS', '销售额', '订单数'],
      [10, 1.2, 12, 3],
    ]);
    // Simulate merge: A1:B1 and C1:D1
    ws['!merges'] = [
      { e: { c: 1, r: 0 }, s: { c: 0, r: 0 } },
      { e: { c: 3, r: 0 }, s: { c: 2, r: 0 } },
    ];
    const table = normalizeWorksheetTable(ws);
    expect(table.headerRowCount).toBe(2);
    expect(table.columns[0]).toMatch(/广告数据/);
    expect(table.columns[0]).toMatch(/花费/);
    expect(table.columns.some((c) => c.includes('ROAS'))).toBe(true);
    expect(table.columns.some((c) => /__EMPTY/i.test(c))).toBe(false);
    expect(table.rows[0]?.[table.columns[0]!]).toBe('10');
  });

  it('dedupes identical column names', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['金额', '金额'],
      [1, 2],
    ]);
    const table = normalizeWorksheetTable(ws);
    expect(table.columns).toEqual(['金额', '金额_2']);
  });

  it('does not fill empty data cells from neighboring values', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['日期', '渠道', '花费'],
      ['2026-08-01', '', 100],
      ['2026-08-02', 'B', 200],
    ]);
    const table = normalizeWorksheetTable(ws);
    expect(table.headerRowCount).toBe(1);
    expect(table.rows[0]).toEqual({ 日期: '2026-08-01', 渠道: '', 花费: '100' });
    expect(table.rows[1]).toEqual({ 日期: '2026-08-02', 渠道: 'B', 花费: '200' });
  });

  it('does not treat categorical data row as second header level', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['状态', '状态'],
      ['打开', '关闭'],
      ['关闭', '打开'],
    ]);
    // Force two distinct columns via first-row duplicates
    const table = normalizeWorksheetTable(ws);
    expect(table.headerRowCount).toBe(1);
    expect(table.columns[0]).toMatch(/^状态/);
    expect(table.rows.length).toBeGreaterThanOrEqual(2);
    expect(table.rows[0]?.[table.columns[0]!]).toBe('打开');
  });
});
