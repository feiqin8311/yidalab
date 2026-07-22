/**
 * Company Skill Store home catalog (YidaLab ops).
 * Keep in sync with docs/company-market-skills.md + company_market_mcps.
 */

export type CatalogRow = {
  name: string;
  purpose: string;
  related: string;
};

/**
 * Market assistants catalog. Keep empty while the company agent market has no
 * published assistants — mirrors the empty 助理 list page.
 */
export const ASSISTANT_CATALOG: CatalogRow[] = [];

export const SKILL_CATALOG: CatalogRow[] = [
  {
    name: 'amazon-research',
    purpose: '亚马逊数据采集编排（搜索→详情→评论）',
    related: 'amazon-keyword-search、amazon-product-detail、amazon-reviews',
  },
  {
    name: 'amazon-keyword-search',
    purpose: '关键词搜商品（Apify）',
    related: 'amazon-research',
  },
  {
    name: 'amazon-product-detail',
    purpose: 'ASIN/URL 抓商品详情',
    related: 'amazon-research',
  },
  {
    name: 'amazon-reviews',
    purpose: '评论抓取',
    related: 'amazon-research、user-pain-miner',
  },
  {
    name: 'dtc-toolkit',
    purpose: 'DTC 总路由：采数/调研/拓品',
    related: 'amazon-research、dtc-market-research、dtc-product-expansion-html',
  },
  {
    name: 'dtc-market-research',
    purpose: '品类深度调研（4 步 HTML 报告）',
    related: 'dtc-toolkit、tavily、market-size-scanner 等',
  },
  {
    name: 'dtc-market-research-orchestrated',
    purpose: '四平面编排式市场调研总控',
    related: 'data-source-orchestrator、market-method-orchestrator、research-output-orchestrator',
  },
  {
    name: 'data-source-orchestrator',
    purpose: '调研数据源编排',
    related: 'dtc-market-research-orchestrated',
  },
  {
    name: 'market-method-orchestrator',
    purpose: '调研方法编排',
    related: 'dtc-market-research-orchestrated',
  },
  {
    name: 'research-output-orchestrator',
    purpose: '调研输出编排',
    related: 'dtc-market-research-orchestrated',
  },
  {
    name: 'dtc-product-expansion-html',
    purpose: '拓品战略 HTML 大屏',
    related: 'dtc-toolkit',
  },
  {
    name: 'ecommerce-product-decision-suite',
    purpose: '产品开发六步决策总览',
    related:
      'market-size-scanner、user-pain-miner、competitor-analyzer、opportunity-spotter、profitability-evaluator',
  },
  {
    name: 'market-size-scanner',
    purpose: '市场规模快速扫描',
    related: 'ecommerce-product-decision-suite、dtc-market-research',
  },
  {
    name: 'user-pain-miner',
    purpose: '用户痛点挖掘',
    related: 'ecommerce-product-decision-suite、amazon-reviews',
  },
  {
    name: 'competitor-analyzer',
    purpose: '竞品卖点拆解',
    related: 'ecommerce-product-decision-suite',
  },
  {
    name: 'opportunity-spotter',
    purpose: '市场空白/创新机会',
    related: 'ecommerce-product-decision-suite',
  },
  {
    name: 'profitability-evaluator',
    purpose: '盈利性 Go/No-Go',
    related: 'ecommerce-product-decision-suite、supply-chain-validator',
  },
  {
    name: 'supply-chain-validator',
    purpose: '1688 成本与定价模型',
    related: 'profitability-evaluator',
  },
  {
    name: 'competitor-visual-analyzer',
    purpose: '竞品主图/营销图视觉分析',
    related: 'visual-strategist',
  },
  {
    name: 'visual-strategist',
    purpose: '竞品图营销策略拆解',
    related: 'competitor-visual-analyzer',
  },
  {
    name: 'ecommerce-product-vision',
    purpose: '商品图清洗 + 视觉分析融合',
    related: 'competitor-visual-analyzer',
  },
  {
    name: 'rufus-research',
    purpose: '浏览器对话 Rufus 做需求调研',
    related: 'rufus-listing-probe、geo-listing-auditor',
  },
  {
    name: 'rufus-listing-probe',
    purpose: '生成 Rufus 探测问题集',
    related: 'rufus-research、rufus-listing-answer-auditor',
  },
  {
    name: 'rufus-listing-answer-auditor',
    purpose: 'Rufus 答案链审 Listing',
    related: 'rufus-listing-probe、listing-rufus-auditor',
  },
  {
    name: 'listing-rufus-auditor',
    purpose: 'Listing 的 Rufus/AI 购物检索审计',
    related: 'rufus-listing-answer-auditor、geo-listing-auditor',
  },
  {
    name: 'geo-listing-auditor',
    purpose: 'Rufus 报告 vs 当前 Listing 对照优化',
    related: 'rufus-research、listing-rufus-auditor',
  },
  {
    name: 'amazon-listing-intent-auditor',
    purpose: '六类搜索意图审 Listing',
    related: 'listing-rufus-auditor',
  },
  {
    name: 'notable-arrivals-checker',
    purpose: '新品/Notable Arrival 徽章就绪度',
    related: 'amazon-listing-intent-auditor',
  },
  {
    name: 'Amazon 电动工具附件 75 字符标题改写',
    purpose: '工具附件标题/亮点改写',
    related: 'amazon-listing-intent-auditor',
  },
  {
    name: 'lingxing-ads',
    purpose: '领星广告「国家+活动+SKU」短查询',
    related: 'key-asin-traffic-alert、lingxing-mcp',
  },
  {
    name: 'key-asin-traffic-alert',
    purpose: '重点 ASIN 流量异常诊断报告',
    related: 'lingxing-ads、sif-mcp',
  },
  {
    name: 'amazon-pd-analysis-26',
    purpose: 'Prime Day 广告复盘（图表+报告）',
    related: 'amazon-targeting-structure-report',
  },
  {
    name: 'amazon-targeting-structure-report',
    purpose: '投放结构分析与出价建议',
    related: 'amazon-pd-analysis-26',
  },
  {
    name: 'sqp-brand-analysis',
    purpose: 'SQP 品牌搜索词周报分析',
    related: '—',
  },
  {
    name: 'tavily',
    purpose: 'Tavily 网页搜索',
    related: 'dtc-market-research',
  },
  {
    name: 'dingtalk-fba-alert',
    purpose: '库存预警口令（品牌固定话术）',
    related: '—',
  },
];

export const MCP_CATALOG: CatalogRow[] = [
  {
    name: 'lingxing-mcp',
    purpose: '领星广告查数（活动/SKU/ASIN/搜索词/否词）',
    related: 'lingxing-ads',
  },
  {
    name: 'sif-mcp',
    purpose: 'SIF 流量/市场/广告分析与运营模板',
    related: 'key-asin-traffic-alert、amazon-research',
  },
  {
    name: 'sellersprite-mcp',
    purpose: '卖家精灵：选品与关键词',
    related: 'dtc-market-research',
  },
  {
    name: 'sorftime-mcp',
    purpose: 'Sorftime 跨境站点数据（亚马逊/TikTok/1688）',
    related: 'dtc-market-research',
  },
  {
    name: 'xydc-mcp',
    purpose: 'XYDC 电商数据服务',
    related: '—',
  },
];
