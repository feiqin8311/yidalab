/**
 * YidaLab company-wide default recommended examples.
 * Used when workspace.settings.recommendedExamples has never been set.
 * Admin/owner can edit under 设置 → 推荐示例 (below Memory).
 *
 * Format: first line = card title only; remaining lines = text filled into input on click.
 * Prefer 【站点】【ASIN】【时间范围】 placeholders (from real OpenClaw sessions).
 * HomeSuggest shows at most 12 chips — keep the highest-value items first.
 */
export const DEFAULT_COMPANY_RECOMMENDED_EXAMPLES: string[] = [
  // 1) Highest-frequency pattern: SIF traffic diagnose (B0BQTHTZG1 / B0C61FCL7Z / B0G81828NR…)
  [
    'ASIN 流量诊断',
    '运用 SIF MCP 分析【站点】【ASIN】近【时间范围，如近14天/近30天】流量变化，拆解自然流量、广告流量，具体到广告活动（全称）和投放词，给出优化方向和 14 天行动建议，输出 HTML 报告。',
  ].join('\n'),

  // 2) Competitor traffic attribution (B0C61FCL7Z vs B0G1RHJG2J…, CA comparisons)
  [
    '本品 vs 竞品流量对比',
    '请对比【本品ASIN】和【竞品ASIN列表】在【站点】【时间范围】的流量趋势、广告流量占比、自然排名、核心关键词竞争变化，判断流量是被竞品抢走、市场需求下降，还是广告结构问题；涉及的广告活动请输出全称，输出 HTML 报告。',
  ].join('\n'),

  // 3) 领星广告短查询 — fill is exactly what operators type day-to-day
  ['领星广告分析', '美国 915113手动广告-ROS-TOS 915113'].join('\n'),

  // 4) Category entry + first ads (Jasmin 类目链接 / 8月上新)
  [
    '类目入场与广告架构',
    '请结合【站点】【类目/关键词或类目链接】近 1–2 年数据，分析淡旺季与市场体量，判断新品【价格带】适合何时入场；整理关键词词库和第一批广告架构（关键词/ASIN、竞价、匹配方式）、推广节奏与销量预估，输出 HTML 报告。',
  ].join('\n'),

  // 5) Listing diagnose (B0CBVSKQDJ CTR low, A+/QA, title+bullets)
  [
    'Listing 诊断与优化',
    '请诊断【ASIN】的 Listing（标题、五点、A+、图片、Q&A、变体、搜索意图、Alexa/Rufus 友好性），指出最大短板与优化优先级；【如有重点问题可写：如点击率低 / 转化差】，给出可直接替换的改写建议，输出 HTML 报告。',
  ].join('\n'),

  // 6) Title pick (exact YPLUS session → generalized)
  [
    'Listing 标题优选（75字符）',
    '请依据 75 字符 title 规范，判断以下标题哪个更好，或给出你的建议标题：\n1.【标题1】\n2.【标题2】\n3.【标题3】\n结合【站点】核心关键词、出单词 ABA 排名与类目竞品参考，以 HTML 形式回复。',
  ].join('\n'),

  // 7+) Remaining catalog (welcome shows up to 12)
  [
    '推广节奏 / 旺季广告布局',
    '请复盘【站点】【ASIN】在【时间范围，如 6–7 月或开学季】的推广节奏，结合价格、Coupon、评论评分、变体、广告投入、核心词自然/广告排名、销量与流量变化；判断哪些动作有效，规划下一阶段广告与价格方案；若需对比活动期可写【如 PD 今年 vs 去年】，输出 HTML 报告。',
  ].join('\n'),

  // remaining extras
  [
    '多 ASIN 评论整合分析',
    '请善用工具帮我做一轮多ASIN的评论整合分析，结合评论内的用户反馈，提取高频的使用场景、使用时机、目标用户画像及跨多类用户画像的共性需求。并生成一份中文 HTML 调研报告。\nASIN如下：\nB00BJFK6N6\nB01KJHTL8U',
  ].join('\n'),

  [
    'DTC 用户场景与痛点画像',
    '请调用 DTC 市场研究 skill，帮我分析Rotary Tool 的用户使用场景和痛点，并帮我建立用户画像',
  ].join('\n'),

  [
    'DTC 站外品牌调研',
    '请调用 DTC 市场研究，分析美国主流社媒关于「【品牌/产品】」的用户评论与讨论，重点判断站外声量、真实口碑、主动营销活动及对我们品牌运营的启发，生成中文 HTML 调研报告。',
  ].join('\n'),

  [
    '销量下跌归因',
    '请分析【站点】【ASIN】近【时间范围】销量下跌原因，可对比【竞品ASIN列表】；拆分流量、广告、排名、价格与转化，给出广告架构与投放词/ASIN 调整建议，输出 HTML 报告。',
  ].join('\n'),

  [
    '竞品广告打法拆解',
    '请拆解以下竞品在【站点】的广告打法、结构与核心词流量：【竞品ASIN列表】；对比本品【本品ASIN】（如有），给出可借鉴动作与规避风险，输出 HTML 报告。',
  ].join('\n'),
];

/** Resolve company list: explicit settings win; missing key → product defaults. */
export const resolveCompanyRecommendedExamples = (raw: unknown): string[] => {
  // Explicitly saved (including empty array) — respect admin choice.
  if (Array.isArray(raw)) {
    return raw.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
  }
  // Never configured — ship defaults.
  return [...DEFAULT_COMPANY_RECOMMENDED_EXAMPLES];
};
