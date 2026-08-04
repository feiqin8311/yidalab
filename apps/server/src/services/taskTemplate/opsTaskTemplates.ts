import type { TaskTemplate } from '@lobechat/const';

/**
 * YidaLab company task templates for the empty-state / recommend grid.
 * Recurring Amazon ops work — not LobeHub Market lifestyle chips.
 *
 * Placeholders 【】 are intentional; the agent should ask or the user fills them.
 * Prefer scheduled “巡检 / 周报 / 复盘” framing with HTML delivery.
 */
export const OPS_TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: 900_001,
    identifier: 'yidalab-asin-traffic-daily',
    title: '重点 ASIN 流量日报',
    description: '广告 / 自然流量归因，异常窗口与动作',
    category: 'operations',
    connectors: [],
    cronPattern: '0 9 * * 1,2,3,4,5',
    interests: ['operations', 'marketing', 'business'],
    instruction:
      '工作日巡检：对【站点】重点 ASIN 列表，调用 SIF + 领星广告数据，诊断近 1 天与近 7 天流量变化。拆分广告流量、自然流量、关键词排名、搜索词、Campaign / Ad Group / Keyword 贡献；输出异常窗口、根因排序和当日可执行优化动作。涉及广告活动请用全称。输出中文 HTML 报告。',
  },
  {
    id: 900_002,
    identifier: 'yidalab-lingxing-ads-health',
    title: '领星广告健康检查',
    description: 'ACoS / 竞价 / 否词八段结论',
    category: 'marketing',
    connectors: [],
    cronPattern: '0 10 * * 1,2,3,4,5',
    interests: ['marketing', 'operations', 'business'],
    instruction:
      '工作日广告巡检：对【站点】【广告活动全称或 ID】与关联【SKU】，调用 company.mcp.lingxing-mcp 的 analyze_campaign（或 lingxing-ads skill），一次取 7/14/30 对比与否词，按固定八段输出。禁止散文式复盘。',
  },
  {
    id: 900_003,
    identifier: 'yidalab-fba-inventory-alert',
    title: 'FBA 库存预警巡检',
    description: '品牌口令库存预警（本人范围）',
    category: 'operations',
    connectors: [],
    cronPattern: '0 8 * * *',
    interests: ['operations', 'business'],
    instruction:
      '每日库存巡检：按当前登录用户身份执行 FBA 库存预警（lobe-fba-alert / dingtalk-fba-alert 规则）。默认 mode=self，仅通知本人；用户未指定品牌时，先确认品牌口令（如 LIBRATON/EZARC/YPLUS 库存预警）。禁止广播群发。汇报 status、alert_count 与失败原因。',
  },
  {
    id: 900_004,
    identifier: 'yidalab-competitor-weekly',
    title: '竞品流量 / 七图周报',
    description: '本品 vs 竞品 + 视觉差异化',
    category: 'marketing',
    connectors: [],
    cronPattern: '0 10 * * 1',
    interests: ['marketing', 'product', 'business'],
    instruction:
      '每周一：对比【本品 ASIN】与【竞品 ASIN 列表】在【站点】近 7 天的流量趋势、广告占比、自然排名、核心词竞争；并分析竞品站内卖点与产品七图（视觉模型），提炼差异化与主图/A+方向。输出中文 HTML 周报。',
  },
  {
    id: 900_005,
    identifier: 'yidalab-listing-rufus-weekly',
    title: 'Listing / Rufus 周检',
    description: '搜索意图 + AI 购物助手友好',
    category: 'product',
    connectors: [],
    cronPattern: '0 11 * * 2',
    interests: ['product', 'marketing', 'business'],
    instruction:
      '每周二：审计【ASIN】Listing（标题、五点、A+、图片、Q&A、变体、后台词）的搜索意图覆盖与 Alexa/Rufus AI 检索友好性，指出最大短板并给出优化优先级与可直接替换改写。输出中文 HTML 报告。',
  },
  {
    id: 900_006,
    identifier: 'yidalab-voc-weekly',
    title: '评论 VOC 周扫',
    description: '差评痛点 + 好评卖点映射',
    category: 'product',
    connectors: [],
    cronPattern: '0 11 * * 3',
    interests: ['product', 'marketing', 'business'],
    instruction:
      '每周三：抓取并分析【ASIN】近 7～14 天评论（含 1–3 星与 4–5 星），提炼痛点优先级、使用场景、用户画像与可强化卖点，并映射到产品改进与 Listing/图片方向。输出中文 HTML 报告。',
  },
  {
    id: 900_007,
    identifier: 'yidalab-category-opportunity',
    title: '类目大盘 / 新品机会',
    description: '淡旺季、垄断度、关键词入口',
    category: 'business',
    connectors: [],
    cronPattern: '0 9 * * 4',
    interests: ['business', 'product', 'marketing'],
    instruction:
      '每周四：调用 SellerSprite、Sorftime、SIF，分析【站点】【类目/关键词】近 30 天流量变化、淡旺季、头部产品与品牌垄断度，判断可切入新品机会，输出类目进入建议与关键词机会表。输出中文 HTML 报告。',
  },
  {
    id: 900_008,
    identifier: 'yidalab-promo-rhythm-weekly',
    title: '推广节奏周复盘',
    description: '价格 / 广告 / 排名时间线',
    category: 'marketing',
    connectors: [],
    cronPattern: '0 15 * * 5',
    interests: ['marketing', 'operations', 'business'],
    instruction:
      '每周五：复盘【ASIN】近 7～14 天推广节奏，结合价格、Coupon、评分、变体、广告投入、核心词自然/广告排名、销量与流量，判断有效动作并给出下一周节奏建议。输出中文 HTML 报告。',
  },
  {
    id: 900_009,
    identifier: 'yidalab-sqp-brand-weekly',
    title: 'SQP 品牌搜索词周报',
    description: '品牌词 / 大盘搜索表现',
    category: 'marketing',
    connectors: [],
    cronPattern: '0 10 * * 1',
    interests: ['marketing', 'business'],
    instruction:
      '每周一：对【站点】【品牌/核心 ASIN】做 SQP 品牌搜索词周报分析（sqp-brand-analysis skill 若可用则优先），总结曝光、点击、转化变化与可抢词机会，输出中文 HTML 周报。',
  },
  {
    id: 900_010,
    identifier: 'yidalab-dtc-brand-weekly',
    title: '站外品牌声量周报',
    description: '美国社媒口碑与营销启发',
    category: 'marketing',
    connectors: [],
    cronPattern: '0 14 * * 5',
    interests: ['marketing', 'business', 'creator'],
    instruction:
      '每周五：调用 DTC 市场研究 skill，分析美国主流社媒关于“【品牌/产品】”的讨论与口碑，判断站外声量、真实反馈、营销动作启发，输出中文 HTML 调研周报。',
  },
] as const;

/** Deterministic shuffle for refreshSeed / stable daily order. */
export const shuffleTaskTemplates = <T>(list: readonly T[], seed: number): T[] => {
  const next = [...list];
  let s = (seed >>> 0) + 1;
  for (let i = next.length - 1; i > 0; i -= 1) {
    s = (s * 1_103_515_245 + 12_345) & 0x7fff_ffff;
    const j = s % (i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

export const hashRecommendationSeed = (value: string): number => {
  let h = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
};

export const pickOpsTaskTemplates = (options: {
  count: number;
  excludeIds?: number[];
  refreshSeed?: string;
  userId: string;
}): TaskTemplate[] => {
  const excluded = new Set(options.excludeIds ?? []);
  const pool = OPS_TASK_TEMPLATES.filter((item) => !excluded.has(item.id));
  const seed = hashRecommendationSeed(
    `${options.userId}:${options.refreshSeed ?? ''}:${options.count}`,
  );
  return shuffleTaskTemplates(pool, seed).slice(0, options.count);
};
