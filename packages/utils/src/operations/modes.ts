import { z } from 'zod';

import {
  asinField,
  asinListField,
  dateField,
  dateRangeField,
  keywordListField,
  marketplaceField,
  selectField,
  textareaField,
  textField,
  zodAsin,
  zodAsinList,
  zodDateRange,
  zodKeywordList,
  zodMarketplace,
  zodOptionalText,
} from './fields';
import { buildOpsPrompt } from './prompt';
import type { OperationsFunctionDef, OperationsModeDef } from './types';

const baseModelTools = {
  required: ['model.tools'] as const,
};

const mode = (
  partial: Omit<
    OperationsModeDef,
    'buildPrompt' | 'promptVersion' | 'maxSteps' | 'requiresTools'
  > & {
    maxSteps?: number;
    promptVersion?: string;
    requiresTools?: boolean;
    workflow: string;
  },
): OperationsModeDef => {
  const {
    workflow,
    maxSteps = 24,
    promptVersion = '1.0.0',
    requiresTools = true,
    ...rest
  } = partial;
  return {
    ...rest,
    maxSteps,
    promptVersion,
    requiresTools,
    buildPrompt: (params) =>
      buildOpsPrompt({
        functionName: rest.functionId,
        modeName: rest.name,
        params,
        reportSections: rest.reportSections,
        workflow,
      }),
  };
};

// ─── 1. ASIN 流量诊断 ───────────────────────────────────────────

const trafficModes: OperationsModeDef[] = [
  mode({
    id: 'traffic-single-asin',
    functionId: 'asin-traffic-diagnosis',
    name: '单 ASIN 流量归因',
    description: '拆分广告/自然流量、异常窗口、关键词与 Campaign 贡献、根因与动作。',
    fields: [
      marketplaceField(),
      asinField({ key: 'asin', label: '本品 ASIN' }),
      asinField({ key: 'competitorAsin', label: '竞品 ASIN', required: false }),
      dateRangeField(),
      keywordListField({ required: false }),
      textField('campaign', 'Campaign', { required: false }),
      textField('adGroup', 'Ad Group', { required: false }),
      textareaField('opsNotes', '运营动作备注', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      asin: zodAsin,
      competitorAsin: zodAsin
        .optional()
        .or(z.literal(''))
        .transform((v) => v || undefined),
      dateRange: zodDateRange,
      keywords: zodKeywordList(50, 0),
      campaign: zodOptionalText,
      adGroup: zodOptionalText,
      opsNotes: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'company.mcp.sif-mcp'],
      optional: ['company.mcp.lingxing-mcp', 'company.mcp.sellersprite-mcp'],
    },
    reportSections: [
      '结论摘要',
      '广告 vs 自然流量',
      '异常时间窗口',
      'Campaign / 关键词 / 搜索词贡献',
      '排名趋势',
      '根因排序',
      '动作建议',
      '数据源与限制',
    ],
    workflow:
      '1) SIF 拉本品流量与排名 2) 有领星则补广告结构 3) 对比异常窗口前后 4) 归因排序 5) 输出 HTML',
  }),
  mode({
    id: 'traffic-vs-competitors',
    functionId: 'asin-traffic-diagnosis',
    name: '本品与竞品对比',
    description: '本品与 1～10 个竞品的流量、排名与关键词格局对比。',
    fields: [
      marketplaceField(),
      asinField({ key: 'asin', label: '本品 ASIN' }),
      asinListField({ key: 'competitorAsins', label: '竞品 ASIN（1～10）', maxItems: 10 }),
      dateRangeField(),
      keywordListField({ required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      asin: zodAsin,
      competitorAsins: zodAsinList(10, 1),
      dateRange: zodDateRange,
      keywords: zodKeywordList(50, 0),
    }),
    capabilities: {
      required: [...baseModelTools.required, 'company.mcp.sif-mcp'],
      optional: ['company.mcp.sellersprite-mcp', 'amazon.product'],
    },
    reportSections: [
      '对比结论',
      '流量与排名矩阵',
      '关键词重叠',
      '差异化机会',
      '动作建议',
      '数据限制',
    ],
    workflow: '1) 拉本品与竞品 SIF 指标 2) 对齐时间窗 3) 关键词/排名对比 4) 输出 HTML',
  }),
  mode({
    id: 'traffic-keyword-ads-lift',
    functionId: 'asin-traffic-diagnosis',
    name: '核心词广告拉升分析',
    description: '围绕核心词评估广告启动/调整后的流量与排名拉升效果。',
    fields: [
      marketplaceField(),
      asinField(),
      keywordListField({ key: 'keywords', label: '核心词', required: true, maxItems: 20 }),
      dateField('adChangeDate', '广告启动/调整日期', { required: true }),
      selectField(
        'analysisScope',
        '分析范围',
        [
          { label: '调整前后 7 天', value: '7d' },
          { label: '调整前后 14 天', value: '14d' },
          { label: '调整前后 30 天', value: '30d' },
        ],
        { required: true, defaultValue: '14d' },
      ),
      textField('campaign', 'Campaign', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      asin: zodAsin,
      keywords: zodKeywordList(20, 1),
      adChangeDate: z.string().min(1),
      analysisScope: z.enum(['7d', '14d', '30d']),
      campaign: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'company.mcp.sif-mcp', 'company.mcp.lingxing-mcp'],
      optional: [],
    },
    reportSections: ['拉升结论', '调整前后对比', '关键词贡献', '广告花费效率', '建议', '数据限制'],
    workflow: '1) SIF 排名/自然 2) 领星广告表现 3) 以调整日切窗对比 4) 输出 HTML',
  }),
  mode({
    id: 'traffic-campaign-drilldown',
    functionId: 'asin-traffic-diagnosis',
    name: 'Campaign/搜索词下钻',
    description: '按 Campaign 下钻 Ad Group、关键词与搜索词表现。',
    fields: [
      marketplaceField(),
      textField('campaign', 'Campaign 名称或 ID', { required: true }),
      dateRangeField(),
      asinField({ required: false }),
      textField('sku', 'SKU', { required: false }),
      textField('adGroup', 'Ad Group', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      campaign: z.string().trim().min(1).max(500),
      dateRange: zodDateRange,
      asin: zodAsin
        .optional()
        .or(z.literal(''))
        .transform((v) => v || undefined),
      sku: zodOptionalText,
      adGroup: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'company.mcp.lingxing-mcp'],
      optional: ['company.mcp.sif-mcp'],
    },
    reportSections: ['Campaign 结论', '结构拆解', '搜索词贡献', '否词/出价建议', '数据限制'],
    workflow: '1) 领星拉 Campaign 全量结构 2) 搜索词排序 3) 可选 SIF 补流量 4) 输出 HTML',
  }),
];

// ─── 2. 类目流量与新品机会 ─────────────────────────────────────

const categoryModes: OperationsModeDef[] = [
  mode({
    id: 'category-market-overview',
    functionId: 'category-opportunity',
    name: '类目大盘分析',
    description: '类目体量、淡旺季、垄断度、价格带与格局。',
    fields: [
      marketplaceField(),
      textField('categoryKeyword', '类目词', { required: true }),
      dateRangeField(),
      textField('priceBand', '价格带', {
        required: false,
        placeholder: 'e.g. 20-40 USD',
        placeholderKey: 'priceBand',
      }),
      textField('productForm', '产品形态', { required: false }),
      asinListField({ key: 'competitorAsins', label: '竞品 ASIN', required: false, maxItems: 10 }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      categoryKeyword: z.string().trim().min(1).max(200),
      dateRange: zodDateRange,
      priceBand: zodOptionalText,
      productForm: zodOptionalText,
      competitorAsins: zodAsinList(10, 0),
    }),
    capabilities: {
      required: [...baseModelTools.required],
      anyOfGroups: [
        ['company.mcp.sellersprite-mcp'],
        ['company.mcp.sorftime-mcp'],
        ['company.mcp.sif-mcp'],
      ],
      optional: ['web.search'],
    },
    reportSections: [
      '大盘结论',
      '体量与淡旺季',
      '垄断度',
      '价格带',
      '切入建议',
      '风险',
      '数据限制',
    ],
    workflow: '1) 市场数据源拉类目 2) 竞品补充 3) 综合体量/格局 4) 输出 HTML',
  }),
  mode({
    id: 'category-aba-trends',
    functionId: 'category-opportunity',
    name: '核心词与 ABA 趋势',
    description: '关键词列表的 ABA/搜索趋势与机会判断。',
    fields: [
      marketplaceField(),
      keywordListField({ required: true, maxItems: 30 }),
      dateRangeField(),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      keywords: zodKeywordList(30, 1),
      dateRange: zodDateRange,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'company.mcp.sellersprite-mcp'],
      optional: ['company.mcp.sif-mcp', 'company.mcp.sorftime-mcp'],
    },
    reportSections: ['趋势结论', '关键词矩阵', '机会词', '风险词', '动作建议', '数据限制'],
    workflow: '1) SellerSprite ABA/趋势 2) 可选 SIF 补 3) 排序机会 4) 输出 HTML',
  }),
  mode({
    id: 'category-bsr-top100',
    functionId: 'category-opportunity',
    name: 'BSR Top100 分析',
    description: '类目节点 BSR 格局、品牌集中与价格带。',
    fields: [
      marketplaceField(),
      textField('categoryNode', '类目节点或类目词', { required: true }),
      textField('priceBand', '价格带', {
        required: false,
        placeholder: 'e.g. 20-40 USD',
        placeholderKey: 'priceBand',
      }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      categoryNode: z.string().trim().min(1).max(300),
      priceBand: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required],
      anyOfGroups: [['company.mcp.sellersprite-mcp'], ['company.mcp.sorftime-mcp']],
      optional: ['amazon.product'],
    },
    reportSections: ['BSR 格局结论', 'Top 品牌', '价格带分布', '新品空间', '数据限制'],
    workflow: '1) 拉 BSR Top 2) 聚合品牌/价格 3) 输出 HTML',
  }),
  mode({
    id: 'category-new-product',
    functionId: 'category-opportunity',
    name: '新品机会判断',
    description: '综合类目与关键词判断新品切入方向与风险。',
    fields: [
      marketplaceField(),
      textField('productOrCategory', '产品/类目', { required: true }),
      dateRangeField({ key: 'dateRange', label: '分析周期' }),
      keywordListField({ required: false }),
      textField('targetPriceBand', '目标价格带', { required: false }),
      textField('productForm', '产品形态', { required: false }),
      asinListField({ key: 'competitorAsins', label: '竞品 ASIN', required: false, maxItems: 10 }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      productOrCategory: z.string().trim().min(1).max(300),
      dateRange: zodDateRange,
      keywords: zodKeywordList(30, 0),
      targetPriceBand: zodOptionalText,
      productForm: zodOptionalText,
      competitorAsins: zodAsinList(10, 0),
    }),
    capabilities: {
      required: [...baseModelTools.required],
      anyOfGroups: [
        ['company.mcp.sellersprite-mcp'],
        ['company.mcp.sorftime-mcp'],
        ['company.mcp.sif-mcp'],
      ],
      optional: ['web.search', 'skill.dtc-market-research'],
    },
    reportSections: ['机会结论', '需求与竞争', '切入方向', '风险清单', '行动优先级', '数据限制'],
    workflow: '1) 市场体量 2) 竞品 3) 关键词 4) 综合机会/风险 5) 输出 HTML',
  }),
];

// ─── 3. ASIN 推广节奏 ───────────────────────────────────────────

const promoModes: OperationsModeDef[] = [
  mode({
    id: 'promo-own-review',
    functionId: 'asin-promo-rhythm',
    name: '本品推广复盘',
    description: '统一时间线复盘价格/广告/Listing 动作对排名与流量的影响。',
    fields: [
      marketplaceField(),
      asinField(),
      dateRangeField(),
      textareaField('actionLog', '改价/优惠/广告/Listing/变体等动作记录', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      asin: zodAsin,
      dateRange: zodDateRange,
      actionLog: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'company.mcp.sif-mcp'],
      optional: ['company.mcp.lingxing-mcp', 'amazon.product'],
    },
    reportSections: [
      '复盘结论',
      '统一时间线',
      '动作影响',
      '排名/销量/流量',
      '下一阶段节奏',
      '数据限制',
    ],
    workflow: '1) SIF 流量排名 2) 领星广告 3) 对齐动作日志 4) 输出 HTML',
  }),
  mode({
    id: 'promo-competitor-rhythm',
    functionId: 'asin-promo-rhythm',
    name: '竞品推广节奏',
    description: '竞品从上架至今或自定义区间的推广节奏拆解。',
    fields: [
      marketplaceField(),
      asinField({ key: 'competitorAsin', label: '竞品 ASIN' }),
      dateRangeField({ required: false, label: '时间范围（空=从上架至今）' }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      competitorAsin: zodAsin,
      dateRange: zodDateRange.optional(),
    }),
    capabilities: {
      required: [...baseModelTools.required],
      anyOfGroups: [['company.mcp.sif-mcp'], ['company.mcp.sellersprite-mcp'], ['amazon.product']],
      optional: [],
    },
    reportSections: ['节奏结论', '时间线', '关键动作推断', '可借鉴点', '数据限制'],
    workflow: '1) 商品与流量 2) 推断推广节点 3) 输出 HTML',
  }),
  mode({
    id: 'promo-next-4-weeks',
    functionId: 'asin-promo-rhythm',
    name: '未来四周策略',
    description: '基于现状给出未来 4 周广告/价格/优惠/Listing 节奏。',
    fields: [
      marketplaceField(),
      asinField(),
      dateField('planStartDate', '计划开始日期', { required: true }),
      textField('salesTarget', '销售目标', { required: false }),
      textField('acosTarget', 'ACOS 目标', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      asin: zodAsin,
      planStartDate: z.string().min(1),
      salesTarget: zodOptionalText,
      acosTarget: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'company.mcp.sif-mcp'],
      optional: ['company.mcp.lingxing-mcp', 'company.mcp.sellersprite-mcp'],
    },
    reportSections: [
      '四周策略总览',
      '周计划',
      '广告节奏',
      '价格/优惠',
      'Listing',
      '风险与监控',
      '数据限制',
    ],
    workflow: '1) 现状诊断 2) 目标对齐 3) 四周拆解 4) 输出 HTML',
  }),
];

// ─── 4. Listing 诊断与优化 ──────────────────────────────────────

const listingBaseFields = [
  marketplaceField(),
  selectField(
    'inputPath',
    '输入路径',
    [
      { label: '已有商品（ASIN/链接）', value: 'existing' },
      { label: '新品资料', value: 'new' },
    ],
    { required: true, defaultValue: 'existing' },
  ),
  asinField({ required: false, label: 'ASIN（已有商品）' }),
  textField('productUrl', '商品链接', { required: false }),
  textareaField('productBrief', '产品资料/当前文案', { required: false }),
  textareaField('targetAudience', '目标用户与场景', { required: false }),
  keywordListField({ required: false, label: '核心词' }),
  asinListField({ key: 'competitorAsins', label: '竞品 ASIN', required: false, maxItems: 5 }),
  textField('titleMaxChars', '标题最大字符（高级）', { required: false, advanced: true }),
  textField('bulletMaxChars', '亮点最大字符（高级）', { required: false, advanced: true }),
];

const listingInputSchema = z
  .object({
    marketplace: zodMarketplace,
    inputPath: z.enum(['existing', 'new']),
    asin: zodAsin
      .optional()
      .or(z.literal(''))
      .transform((v) => v || undefined),
    productUrl: zodOptionalText,
    productBrief: zodOptionalText,
    targetAudience: zodOptionalText,
    keywords: zodKeywordList(30, 0),
    competitorAsins: zodAsinList(5, 0),
    titleMaxChars: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce.number().int().min(20).max(300).optional(),
    ),
    bulletMaxChars: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce.number().int().min(50).max(1000).optional(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.inputPath === 'existing' && !v.asin && !v.productUrl) {
      ctx.addIssue({ code: 'custom', message: '已有商品需 ASIN 或链接', path: ['asin'] });
    }
    if (v.inputPath === 'new' && !v.productBrief) {
      ctx.addIssue({ code: 'custom', message: '新品需产品资料', path: ['productBrief'] });
    }
  });

const listingModes: OperationsModeDef[] = [
  mode({
    id: 'listing-full-audit',
    functionId: 'listing-optimization',
    name: 'Listing 综合审计',
    description: '标题/亮点/描述/关键词覆盖与转化逻辑综合审计。',
    fields: listingBaseFields,
    inputSchema: listingInputSchema,
    capabilities: {
      required: [...baseModelTools.required, 'skill.amazon-listing-intent-auditor'],
      optional: ['amazon.product', 'skill.listing-rufus-auditor'],
    },
    reportSections: ['审计结论', '标题', '亮点', '描述/A+', '关键词覆盖', '改写建议', '数据限制'],
    workflow: '1) 获取 Listing 2) 意图审计 3) 改写建议 4) 输出 HTML',
  }),
  mode({
    id: 'listing-rufus-rewrite',
    functionId: 'listing-optimization',
    name: 'Rufus/Alexa 友好改写',
    description: '按 Rufus/Alexa 可读性与属性完整性改写 Listing。',
    fields: listingBaseFields,
    inputSchema: listingInputSchema,
    capabilities: {
      required: [...baseModelTools.required, 'skill.listing-rufus-auditor'],
      optional: ['amazon.product', 'skill.amazon-listing-intent-auditor'],
    },
    reportSections: ['改写结论', '属性缺口', 'Rufus 友好文案', '对比原版', '数据限制'],
    workflow: '1) 获取 Listing 2) Rufus 审计 3) 改写 4) 输出 HTML',
  }),
  mode({
    id: 'listing-intent-gap',
    functionId: 'listing-optimization',
    name: '搜索意图缺口分析',
    description: '对照核心搜索意图找出 Listing 内容缺口。',
    fields: listingBaseFields,
    inputSchema: listingInputSchema,
    capabilities: {
      required: [...baseModelTools.required, 'skill.amazon-listing-intent-auditor'],
      optional: ['company.mcp.sellersprite-mcp', 'amazon.product'],
    },
    reportSections: ['意图地图', '覆盖矩阵', '缺口清单', '补全建议', '数据限制'],
    workflow: '1) 意图拆解 2) Listing 对齐 3) 缺口 4) 输出 HTML',
  }),
];

// ─── 5. 评论与 VOC ──────────────────────────────────────────────

const vocModes: OperationsModeDef[] = [
  mode({
    id: 'voc-low-star-pain',
    functionId: 'review-voc',
    name: '一至三星差评痛点',
    description: '差评主题、场景、画像与产品改进优先级。',
    fields: [
      marketplaceField(),
      asinField(),
      dateRangeField(),
      selectField('starRange', '星级范围', [{ label: '1～3 星', value: '1-3' }], {
        required: true,
        defaultValue: '1-3',
        lockedValue: '1-3',
      }),
      textField('themeFilter', '主题筛选', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      asin: zodAsin,
      dateRange: zodDateRange,
      starRange: z.literal('1-3').default('1-3'),
      themeFilter: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'amazon.reviews', 'skill.user-pain-miner'],
      optional: ['skill.dtc-market-research', 'web.search'],
    },
    reportSections: ['痛点结论', 'VOC 分类', '场景与画像', '原意摘要', '改进优先级', '数据限制'],
    workflow: '1) 拉评论 2) 痛点挖掘 3) 聚类排序 4) 输出 HTML',
  }),
  mode({
    id: 'voc-high-star-opportunity',
    functionId: 'review-voc',
    name: '四至五星卖点机会',
    description: '好评中的可放大卖点与内容方向。',
    fields: [
      marketplaceField(),
      asinField(),
      dateRangeField(),
      selectField('starRange', '星级范围', [{ label: '4～5 星', value: '4-5' }], {
        required: true,
        defaultValue: '4-5',
        lockedValue: '4-5',
      }),
      textField('themeFilter', '主题筛选', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      asin: zodAsin,
      dateRange: zodDateRange,
      starRange: z.literal('4-5').default('4-5'),
      themeFilter: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'amazon.reviews', 'skill.user-pain-miner'],
      optional: ['web.search'],
    },
    reportSections: ['卖点结论', 'VOC 分类', '内容方向', 'Listing 强化点', '数据限制'],
    workflow: '1) 拉好评 2) 卖点聚类 3) 内容建议 4) 输出 HTML',
  }),
  mode({
    id: 'voc-vs-competitors',
    functionId: 'review-voc',
    name: '本品与竞品 VOC 对比',
    description: '多 ASIN 评论主题对比与差异化机会。',
    fields: [
      marketplaceField(),
      asinField({ key: 'asin', label: '本品 ASIN' }),
      asinListField({ key: 'competitorAsins', label: '竞品 ASIN', maxItems: 5 }),
      dateRangeField(),
      textField('themeFilter', '主题筛选', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: zodMarketplace,
      asin: zodAsin,
      competitorAsins: zodAsinList(5, 1),
      dateRange: zodDateRange,
      themeFilter: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'amazon.reviews', 'skill.user-pain-miner'],
      optional: ['skill.competitor-analyzer'],
    },
    reportSections: ['对比结论', '主题矩阵', '本品优势/劣势', '差异化空间', '数据限制'],
    workflow: '1) 多 ASIN 评论 2) 主题对齐 3) 对比 4) 输出 HTML',
  }),
];

// ─── 6. 竞品与视觉策略 ──────────────────────────────────────────

const visualModes: OperationsModeDef[] = [
  mode({
    id: 'comp-full-breakdown',
    functionId: 'competitor-visual',
    name: '竞品综合拆解',
    description: '竞品卖点结构、转化逻辑与差异化空间。',
    fields: [
      marketplaceField(),
      asinListField({ key: 'competitorAsins', label: '竞品 ASIN', required: false, maxItems: 5 }),
      textField('productUrl', '商品链接', { required: false }),
      textareaField('ourBrief', '我方产品资料', { required: false }),
      keywordListField({ required: false, label: '目标关键词' }),
      textField('priceBand', '价格带', {
        required: false,
        placeholder: 'e.g. 20-40 USD',
        placeholderKey: 'priceBand',
      }),
    ],
    inputSchema: z
      .object({
        marketplace: zodMarketplace,
        competitorAsins: zodAsinList(5, 0),
        productUrl: zodOptionalText,
        ourBrief: zodOptionalText,
        keywords: zodKeywordList(20, 0),
        priceBand: zodOptionalText,
      })
      .refine((v) => (v.competitorAsins?.length ?? 0) > 0 || !!v.productUrl, {
        message: '需要竞品 ASIN 或商品链接',
      }),
    capabilities: {
      required: [...baseModelTools.required, 'skill.competitor-analyzer'],
      optional: ['amazon.product', 'company.mcp.sellersprite-mcp'],
    },
    reportSections: ['拆解结论', '竞品对比', '卖点结构', '转化逻辑', '差异化', '数据限制'],
    workflow: '1) 商品详情 2) 竞品分析 3) 对比我方 4) 输出 HTML',
  }),
  mode({
    id: 'comp-visual-seven-plus',
    functionId: 'competitor-visual',
    name: '主图、七图与 A+ 视觉拆解',
    description: '主图/七图/A+ 视觉意图与我方图片脚本。',
    fields: [
      marketplaceField(),
      asinListField({ key: 'competitorAsins', label: '竞品 ASIN', required: false, maxItems: 5 }),
      textField('productUrl', '商品链接', { required: false }),
      textareaField('ourBrief', '我方产品资料', { required: false }),
      keywordListField({ required: false, label: '目标关键词' }),
    ],
    inputSchema: z
      .object({
        marketplace: zodMarketplace,
        competitorAsins: zodAsinList(5, 0),
        productUrl: zodOptionalText,
        ourBrief: zodOptionalText,
        keywords: zodKeywordList(20, 0),
      })
      .refine((v) => (v.competitorAsins?.length ?? 0) > 0 || !!v.productUrl, {
        message: '需要竞品 ASIN 或商品链接',
      }),
    capabilities: {
      required: [...baseModelTools.required, 'skill.competitor-visual-analyzer', 'model.vision'],
      optional: ['amazon.product', 'skill.competitor-analyzer'],
    },
    requiresVision: true,
    reportSections: ['视觉结论', '主图/七图意图', 'A+ 结构', '我方图片脚本', '数据限制'],
    workflow: '1) 拉图 2) 视觉分析 3) 脚本 4) 输出 HTML',
  }),
];

// ─── 7. 站内外品牌调研 ──────────────────────────────────────────

const brandModes: OperationsModeDef[] = [
  mode({
    id: 'brand-external-voice',
    functionId: 'brand-research',
    name: '站外品牌声量',
    description: '社媒与站外声量、营销动作与内容启发（DTC 固定美国市场）。',
    fields: [
      marketplaceField({ lockedValue: 'US', defaultValue: 'US' }),
      textField('brand', '品牌', { required: true }),
      textField('productOrCategory', '产品/类目', { required: true }),
      textareaField('focus', '调研重点', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: z.literal('US').default('US'),
      brand: z.string().trim().min(1).max(200),
      productOrCategory: z.string().trim().min(1).max(300),
      focus: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'skill.dtc-market-research'],
      optional: ['web.search'],
    },
    reportSections: ['声量结论', '社媒与渠道', '营销动作', '内容启发', '数据限制'],
    workflow: '1) DTC 调研 2) Web 补充 3) 输出 HTML',
  }),
  mode({
    id: 'brand-cross-feedback',
    functionId: 'brand-research',
    name: '站内外用户反馈',
    description: '站外口碑与 Amazon 反馈对照。',
    fields: [
      marketplaceField({ lockedValue: 'US', defaultValue: 'US' }),
      textField('brand', '品牌', { required: true }),
      textField('productOrCategory', '产品/类目', { required: true }),
      asinField({ required: false, label: '相关 ASIN' }),
      textareaField('focus', '调研重点', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: z.literal('US').default('US'),
      brand: z.string().trim().min(1).max(200),
      productOrCategory: z.string().trim().min(1).max(300),
      asin: zodAsin
        .optional()
        .or(z.literal(''))
        .transform((v) => v || undefined),
      focus: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'skill.dtc-market-research'],
      optional: ['amazon.reviews', 'web.search', 'skill.user-pain-miner'],
    },
    reportSections: ['反馈结论', '站外口碑', 'Amazon 反馈', '对照洞察', '数据限制'],
    workflow: '1) DTC 2) 可选评论 3) 对照 4) 输出 HTML',
  }),
  mode({
    id: 'brand-multi-benchmark',
    functionId: 'brand-research',
    name: '多品牌对标',
    description: '多品牌声量、定位与内容策略对标。',
    fields: [
      marketplaceField({ lockedValue: 'US', defaultValue: 'US' }),
      textField('brands', '品牌列表（逗号分隔）', { required: true }),
      textField('productOrCategory', '产品/类目', { required: true }),
      textareaField('focus', '调研重点', { required: false }),
    ],
    inputSchema: z.object({
      marketplace: z.literal('US').default('US'),
      brands: z.string().trim().min(1).max(500),
      productOrCategory: z.string().trim().min(1).max(300),
      focus: zodOptionalText,
    }),
    capabilities: {
      required: [...baseModelTools.required, 'skill.dtc-market-research'],
      optional: ['web.search'],
    },
    reportSections: ['对标结论', '品牌矩阵', '定位差异', '可借鉴动作', '数据限制'],
    workflow: '1) 多品牌 DTC 2) 矩阵对比 3) 输出 HTML',
  }),
];

export const OPERATIONS_FUNCTIONS: OperationsFunctionDef[] = [
  {
    id: 'asin-traffic-diagnosis',
    name: 'ASIN 流量诊断',
    description: '广告/自然归因、竞品对比、核心词拉升与 Campaign 下钻。',
    path: '/functions/asin-traffic-diagnosis',
    modes: trafficModes,
  },
  {
    id: 'category-opportunity',
    name: '类目流量与新品机会',
    description: '类目大盘、ABA 趋势、BSR Top100 与新品机会。',
    path: '/functions/category-opportunity',
    modes: categoryModes,
  },
  {
    id: 'asin-promo-rhythm',
    name: 'ASIN 推广节奏',
    description: '本品复盘、竞品节奏与未来四周策略。',
    path: '/functions/asin-promo-rhythm',
    modes: promoModes,
  },
  {
    id: 'listing-optimization',
    name: 'Listing 诊断与优化',
    description: '综合审计、Rufus 改写与搜索意图缺口。',
    path: '/functions/listing-optimization',
    modes: listingModes,
  },
  {
    id: 'review-voc',
    name: '评论与 VOC 分析',
    description: '差评痛点、好评卖点与竞品 VOC 对比。',
    path: '/functions/review-voc',
    modes: vocModes,
  },
  {
    id: 'competitor-visual',
    name: '竞品与视觉策略',
    description: '竞品综合拆解与主图/七图/A+ 视觉脚本。',
    path: '/functions/competitor-visual',
    modes: visualModes,
  },
  {
    id: 'brand-research',
    name: '站内外品牌调研',
    description: '站外声量、站内外反馈与多品牌对标（美国）。',
    path: '/functions/brand-research',
    modes: brandModes,
  },
];

export const ALL_OPERATIONS_MODES: OperationsModeDef[] = OPERATIONS_FUNCTIONS.flatMap(
  (f) => f.modes,
);

export const getOperationsFunction = (id: string) => OPERATIONS_FUNCTIONS.find((f) => f.id === id);

export const getOperationsMode = (modeId: string) =>
  ALL_OPERATIONS_MODES.find((m) => m.id === modeId);

export const OPERATIONS_MODE_COUNT = ALL_OPERATIONS_MODES.length;
