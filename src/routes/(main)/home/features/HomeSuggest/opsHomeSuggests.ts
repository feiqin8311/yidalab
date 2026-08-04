/**
 * YidaLab 运营首页推荐示例。
 * 面向真实亚马逊运营场景，不是平台基建工具（artifacts / memory / dingpan 等）的“试用芯片”。
 */

export interface OpsHomeSuggest {
  /** Card subtitle (short) */
  description: string;
  /** Stable id for React keys / shuffle */
  id: string;
  /** Full prompt filled into the home input on click */
  prompt: string;
  /** Card title */
  title: string;
}

/**
 * Curated chips. Placeholders 【】 are intentional — agent should ask or user fills in.
 * Prefer “站点 + ASIN/关键词 + 时间 + 目标 + HTML/钉盘” shape.
 */
export const OPS_HOME_SUGGESTS: readonly OpsHomeSuggest[] = [
  {
    id: 'asin-traffic',
    title: 'ASIN 流量诊断',
    description: 'SIF + 领星：广告/自然流量归因',
    prompt:
      '请调用 SIF 和领星广告数据，帮我诊断【站点】【ASIN】最近【时间范围】流量变化原因。请拆分广告流量、自然流量、关键词排名、搜索词、Campaign / Ad Group / Keyword 贡献变化，并输出异常窗口、根因排序和优化动作。输出中文 HTML 报告。',
  },
  {
    id: 'competitor-traffic',
    title: '本品 vs 竞品流量',
    description: '对比竞品抢量 / 大盘 / 广告结构',
    prompt:
      '请对比【本品ASIN】和【竞品ASIN列表】在【站点】【时间范围】的流量趋势、广告流量占比、自然排名、核心关键词竞争变化，判断我们的流量是被竞品抢走、市场需求下降，还是广告结构问题。涉及的广告活动请输出全称，输出中文 HTML 报告。',
  },
  {
    id: 'category-market',
    title: '类目大盘 / 新品机会',
    description: '淡旺季、垄断度、关键词入口',
    prompt:
      '请调用 SellerSprite、Sorftime 和 SIF，帮我分析【站点】【类目/关键词】最近【时间范围】的类目流量变化、淡旺季、头部产品和品牌垄断度变化，判断是否存在可切入的新品机会，并输出类目进入建议与关键词机会表。输出中文 HTML 报告。',
  },
  {
    id: 'listing-audit',
    title: 'Listing / Rufus 审计',
    description: '搜索意图 + AI 购物助手友好',
    prompt:
      '请审计【ASIN】的 Listing：从标题、五点、A+、图片、Q&A、变体、后台词、搜索意图覆盖和 Alexa/Rufus AI 检索友好性角度，指出最大短板并给出优化优先级与可直接替换的改写。输出中文 HTML 报告。',
  },
  {
    id: 'voc-reviews',
    title: '评论 VOC / 痛点',
    description: '差评分类 + 卖点与改进点',
    prompt:
      '请抓取并分析【ASIN】最近【时间范围】的评论（含一到三星差评与四到五星好评），提炼痛点优先级、使用场景、用户画像与可强化卖点，并映射到产品改进和 Listing/图片方向。输出中文 HTML 报告。',
  },
  {
    id: 'competitor-visual',
    title: '竞品拆解 + 七图',
    description: '卖点、视觉策略、差异化空间',
    prompt:
      '请分析竞品【ASIN】在亚马逊【站点】的站内产品卖点、产品七图（调用视觉模型）、价格/评分/变体与用户反馈，重点提炼痛点、差评和使用场景，并给出我们可切入的差异化与主图/A+方向。输出中文 HTML 调研报告。',
  },
  {
    id: 'dtc-brand',
    title: '站内外品牌调研',
    description: 'DTC：社媒口碑与营销启发（美国）',
    prompt:
      '请调用 DTC 市场研究 skill，帮我分析美国主流社媒渠道关于“【品牌/产品】”的用户评论和讨论，重点判断站外声量、真实口碑、主动营销活动以及对我们品牌运营的启发，并生成一份中文 HTML 调研报告。',
  },
  {
    id: 'promo-rhythm',
    title: '推广节奏复盘',
    description: '价格/广告/排名时间线',
    prompt:
      '请复盘【ASIN】在【时间范围】的推广节奏，结合价格、Coupon、评论评分、变体、广告投入、核心词自然/广告排名、销量和流量变化，判断哪些动作有效，并给出下一阶段 4 周节奏建议。输出中文 HTML 报告。',
  },
  {
    id: 'lingxing-short',
    title: '领星广告短查询',
    description: '国家 + 活动 + SKU 固定八段',
    prompt:
      '美国 【广告活动全称或ID】 【SKU】\n（领星短查询：analyze_campaign 一次取 7/14/30 对比，按固定八段输出结论、基础数据、竞价与否词建议）',
  },
] as const;

const shuffle = <T>(list: readonly T[], seed: number): T[] => {
  const next = [...list];
  // Deterministic-ish shuffle: seed 0 keeps catalog order; refresh bumps seed.
  let s = seed + 1;
  for (let i = next.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fff_ffff;
    const j = s % (i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

export const pickOpsHomeSuggests = (shuffleToken: number, maxItems: number): OpsHomeSuggest[] =>
  shuffle(OPS_HOME_SUGGESTS, shuffleToken).slice(0, maxItems);
