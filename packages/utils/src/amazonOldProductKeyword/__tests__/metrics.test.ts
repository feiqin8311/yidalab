import { describe, expect, it } from 'vitest';

import {
  addMetrics,
  buildDateWindows,
  classifySbChannel,
  parseNumber,
  parsePercent,
  safeDiv,
  spTrend,
} from '../metrics';

describe('metrics', () => {
  it('safeDiv and rates', () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(safeDiv(10, 2)).toBe(5);
    expect(addMetrics({ orders: 1, clicks: 2 }, { orders: 3, clicks: 4 }).orders).toBe(4);
  });

  it('parses numbers and percents', () => {
    expect(parseNumber('$1,234.5')).toBe(1234.5);
    expect(parsePercent('12%')).toBeCloseTo(0.12);
    expect(parsePercent(0.35)).toBeCloseTo(0.35);
  });

  it('date windows non-overlapping', () => {
    const end = new Date('2026-07-25T00:00:00Z');
    const w = buildDateWindows(end);
    expect(w.last30Start.toISOString().slice(0, 10)).toBe('2026-06-26');
    expect(w.prev30End.toISOString().slice(0, 10)).toBe('2026-06-25');
    expect(w.prev30Start.toISOString().slice(0, 10)).toBe('2026-05-27');
  });

  it('sp trend new label', () => {
    expect(spTrend(3, 0).label).toBe('新增');
    expect(spTrend(4, 2).trend).toBe(1);
  });

  it('sb channel', () => {
    expect(classifySbChannel('SBV-视频-xxx')).toBe('sbv');
    expect(classifySbChannel('SBH品牌头条')).toBe('sbh');
    expect(classifySbChannel('SB-其他')).toBe('other');
  });
});
