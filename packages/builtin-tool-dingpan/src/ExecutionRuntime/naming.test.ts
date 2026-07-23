// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildHtmlDeliverableName, sanitizeFilenameSegment, shanghaiDateParts } from './naming';

describe('dingpan naming', () => {
  it('builds the canonical HTML name for the JP promo retro example', () => {
    const name = buildHtmlDeliverableName({
      asin: 'B0GVDTV1J6',
      date: new Date('2026-07-23T08:00:00+08:00'),
      site: '日本',
      taskType: '推广复盘',
      userName: '柯鹏翔',
    });
    expect(name).toBe('B0GVDTV1J6_日本_推广复盘_柯鹏翔_20260723.html');
  });

  it('skips empty segments and sanitizes illegal chars', () => {
    expect(sanitizeFilenameSegment('a/b:c')).toBe('a_b_c');
    const name = buildHtmlDeliverableName({
      date: new Date('2026-07-23T08:00:00+08:00'),
      keyword: 'carbide burr',
      taskType: '流量诊断',
      userName: '柯鹏翔',
    });
    expect(name).toBe('carbideburr_流量诊断_柯鹏翔_20260723.html');
  });

  it('returns YYYY-MM-DD folder for Shanghai day', () => {
    const { folder, compact } = shanghaiDateParts(new Date('2026-07-23T08:00:00+08:00'));
    expect(folder).toBe('2026-07-23');
    expect(compact).toBe('20260723');
  });
});
