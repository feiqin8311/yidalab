import type { AnalysisSections, NegativeSection } from './types';

export const formatBidRuleLines = (lines: AnalysisSections['bidWithOrders']['lines']): string[] =>
  lines.map((l) => `- ${l.title} — 动作：${l.action} — ${l.hit}`);

export const resolveCpoCaps = (sections: AnalysisSections) => {
  const doubleCpo =
    sections.baseData.thresholds
      .find((l) => l.includes('双倍'))
      ?.split('：')[1]
      ?.trim() || '数据缺失';
  const highCpo =
    sections.baseData.thresholds
      .find((l) => l.includes('高 CPO'))
      ?.split('：')[1]
      ?.trim() || '数据缺失';
  return { doubleCpo, highCpo };
};

/** Same lines for UI cards and Markdown §5/§6/§7 — single source of truth. */
export const formatNegativeLines = (
  section: NegativeSection,
  doubleCpo: string,
  highCpo: string,
): string[] => {
  const kw =
    section.keywordHits.length > 0
      ? section.keywordHits.map((h) => `- 词，点击>2×CPO（>${doubleCpo}）不出单 — ${h}`)
      : [`- 词，点击>2×CPO（>${doubleCpo}）不出单 — ${section.noneLabel}`];
  const asin =
    section.asinHits.length > 0
      ? section.asinHits.map((h) => `- ASIN，点击>1.5×CPO（>${highCpo}）不出单 — ${h}`)
      : [`- ASIN，点击>1.5×CPO（>${highCpo}）不出单 — ${section.noneLabel}`];
  return [...kw, ...asin, '- 其余情况 — 动作：维持原状，保持不变'];
};

const bidLines = (lines: AnalysisSections['bidWithOrders']['lines']) =>
  formatBidRuleLines(lines).join('\n');

const negativeBlock = (section: NegativeSection, doubleCpo: string, highCpo: string) =>
  formatNegativeLines(section, doubleCpo, highCpo).join('\n');

/** Fixed V7 markdown body (without outer fence). */
export const buildV7Markdown = (sections: AnalysisSections): string => {
  const { doubleCpo, highCpo } = resolveCpoCaps(sections);

  const parts = [
    '## 1) 结论',
    `- ${sections.conclusion.detail}`,
    '',
    '---',
    '',
    '## 2) 基础数据',
    '### 单活动近7天 vs 前7天',
    ...sections.baseData.compare7d,
    '',
    '### 单活动近14天 vs 前14天',
    ...sections.baseData.compare14d,
    '',
    '### 单活动近30天 vs 前30天',
    ...sections.baseData.compare30d,
  ];

  if (sections.baseData.bestWeek) {
    parts.push('', '### 单活动近30天最佳连续7天', sections.baseData.bestWeek);
  }

  parts.push('', '### 全品14天汇总');
  parts.push(sections.baseData.sku14d || '- 数据缺失');
  if (sections.baseData.sku30d) {
    parts.push('', '### 全品30天汇总', sections.baseData.sku30d);
  }
  parts.push('', '### 阈值', ...sections.baseData.thresholds);

  parts.push(
    '',
    '---',
    '',
    '## 3) 规则-竞价出单',
    sections.bidWithOrders.current,
    bidLines(sections.bidWithOrders.lines),
  );
  if (sections.bidWithOrders.volatilityNote) {
    parts.push(`- ${sections.bidWithOrders.volatilityNote}`);
  }

  parts.push('', '---', '', '## 4) 规则-竞价不出单');
  if (sections.bidZeroOrders.note) parts.push(`- ${sections.bidZeroOrders.note}`);
  parts.push(bidLines(sections.bidZeroOrders.lines));

  parts.push(
    '',
    '---',
    '',
    '## 5) 规则-超高点击不出单,关闭原投放',
    negativeBlock(sections.negativeTarget, doubleCpo, highCpo),
    '',
    '---',
    '',
    '## 6) 规则-单广告活动否词',
    negativeBlock(sections.negativeAd, doubleCpo, highCpo),
    '',
    '---',
    '',
    '## 7) 规则-全品搜索词否词',
    negativeBlock(sections.negativeAdGroups, doubleCpo, highCpo),
    '',
    '---',
    '',
    '## 8) 复原推荐参数',
    ...sections.restore.lines,
  );

  return parts.join('\n');
};
