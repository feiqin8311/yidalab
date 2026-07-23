import { describe, expect, it } from 'vitest';

import {
  mergeRecommendExamples,
  openingQuestionsToSuggestItems,
} from './openingQuestionsToSuggestItems';

describe('openingQuestionsToSuggestItems', () => {
  it('maps multi-line: first line title only, body is click prompt', () => {
    const items = openingQuestionsToSuggestItems([
      'ASIN 流量诊断\n请诊断【站点】【ASIN】最近【时间范围】流量变化，输出 HTML 报告',
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'opening',
      title: 'ASIN 流量诊断',
      description: '请诊断【站点】【ASIN】最近【时间范围】流量变化，输出 HTML 报告',
      prompt: '请诊断【站点】【ASIN】最近【时间范围】流量变化，输出 HTML 报告',
    });
  });

  it('lingxing short query fills only the operator string, not the card title', () => {
    const items = openingQuestionsToSuggestItems([
      '领星广告分析\n美国 915113手动广告-ROS-TOS 915113',
    ]);
    expect(items[0]!.title).toBe('领星广告分析');
    expect(items[0]!.prompt).toBe('美国 915113手动广告-ROS-TOS 915113');
  });

  it('truncates long single-line titles and skips empty entries', () => {
    const long = '请'.repeat(50);
    const items = openingQuestionsToSuggestItems(['  ', long, '短问']);

    expect(items).toHaveLength(2);
    expect(items[0]!.title.endsWith('…')).toBe(true);
    expect(items[0]!.title.length).toBeLessThanOrEqual(36);
    expect(items[0]!.prompt).toBe(long);
    expect(items[1]!.title).toBe('短问');
  });

  it('caps at 12 items', () => {
    const items = openingQuestionsToSuggestItems(Array.from({ length: 15 }, (_, i) => `q${i}`));
    expect(items).toHaveLength(12);
  });
});

describe('mergeRecommendExamples', () => {
  it('puts company examples first, then agent; dedupes by prompt', () => {
    // multi-line: prompt is body only
    const items = mergeRecommendExamples(
      ['公司\n公司通用 A', '重复标题\n重复'],
      ['助理\n重复', '助理2\n本助理 B'],
      6,
    );
    expect(items.map((i) => i.prompt)).toEqual(['公司通用 A', '重复', '本助理 B']);
    expect(items.map((i) => i.source)).toEqual(['company', 'company', 'opening']);
  });

  it('caps total at maxItems', () => {
    const items = mergeRecommendExamples(['c1', 'c2', 'c3'], ['a1', 'a2', 'a3', 'a4'], 4);
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.prompt)).toEqual(['c1', 'c2', 'c3', 'a1']);
  });

  it('default cap allows 12 company scenarios', () => {
    const company = Array.from({ length: 15 }, (_, i) => `公司${i}`);
    const items = mergeRecommendExamples(company, []);
    expect(items).toHaveLength(12);
  });
});
