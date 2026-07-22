# 公司技能市场（Skills 页签）

来源：Skill 市场 → **Skills** 页签 → `company_market_skills`\
产品内展示：Skill 市场 → **首页**（`src/features/SkillStore/Home`）\
整理时间：2026-07-22・当前共 **36** 条（已下架 skill-creator）

| skill                               | 作用                                 | 关联 skill                                                                                              |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| amazon-research                     | 亚马逊数据采集编排（搜索→详情→评论） | amazon-keyword-search、amazon-product-detail、amazon-reviews                                            |
| amazon-keyword-search               | 关键词搜商品（Apify）                | amazon-research                                                                                         |
| amazon-product-detail               | ASIN/URL 抓商品详情                  | amazon-research                                                                                         |
| amazon-reviews                      | 评论抓取                             | amazon-research、user-pain-miner                                                                        |
| dtc-toolkit                         | DTC 总路由：采数 / 调研 / 拓品       | amazon-research、dtc-market-research、dtc-product-expansion-html                                        |
| dtc-market-research                 | 品类深度调研（4 步 HTML 报告）       | dtc-toolkit、tavily、market-size-scanner 等                                                             |
| dtc-market-research-orchestrated    | 四平面编排式市场调研总控             | data-source-orchestrator、market-method-orchestrator、research-output-orchestrator                      |
| data-source-orchestrator            | 调研数据源编排                       | dtc-market-research-orchestrated                                                                        |
| market-method-orchestrator          | 调研方法编排                         | dtc-market-research-orchestrated                                                                        |
| research-output-orchestrator        | 调研输出编排                         | dtc-market-research-orchestrated                                                                        |
| dtc-product-expansion-html          | 拓品战略 HTML 大屏                   | dtc-toolkit                                                                                             |
| ecommerce-product-decision-suite    | 产品开发六步决策总览                 | market-size-scanner、user-pain-miner、competitor-analyzer、opportunity-spotter、profitability-evaluator |
| market-size-scanner                 | 市场规模快速扫描                     | ecommerce-product-decision-suite、dtc-market-research                                                   |
| user-pain-miner                     | 用户痛点挖掘                         | ecommerce-product-decision-suite、amazon-reviews                                                        |
| competitor-analyzer                 | 竞品卖点拆解                         | ecommerce-product-decision-suite                                                                        |
| opportunity-spotter                 | 市场空白 / 创新机会                  | ecommerce-product-decision-suite                                                                        |
| profitability-evaluator             | 盈利性 Go/No-Go                      | ecommerce-product-decision-suite、supply-chain-validator                                                |
| supply-chain-validator              | 1688 成本与定价模型                  | profitability-evaluator                                                                                 |
| competitor-visual-analyzer          | 竞品主图 / 营销图视觉分析            | visual-strategist                                                                                       |
| visual-strategist                   | 竞品图营销策略拆解                   | competitor-visual-analyzer                                                                              |
| ecommerce-product-vision            | 商品图清洗 + 视觉分析融合            | competitor-visual-analyzer                                                                              |
| rufus-research                      | 浏览器对话 Rufus 做需求调研          | rufus-listing-probe、geo-listing-auditor                                                                |
| rufus-listing-probe                 | 生成 Rufus 探测问题集                | rufus-research、rufus-listing-answer-auditor                                                            |
| rufus-listing-answer-auditor        | Rufus 答案链审 Listing               | rufus-listing-probe、listing-rufus-auditor                                                              |
| listing-rufus-auditor               | Listing 的 Rufus/AI 购物检索审计     | rufus-listing-answer-auditor、geo-listing-auditor                                                       |
| geo-listing-auditor                 | Rufus 报告 vs 当前 Listing 对照优化  | rufus-research、listing-rufus-auditor                                                                   |
| amazon-listing-intent-auditor       | 六类搜索意图审 Listing               | listing-rufus-auditor                                                                                   |
| notable-arrivals-checker            | 新品 / Notable Arrival 徽章就绪度    | amazon-listing-intent-auditor                                                                           |
| Amazon 电动工具附件 75 字符标题改写 | 工具附件标题 / 亮点改写              | amazon-listing-intent-auditor                                                                           |
| lingxing-ads                        | 领星广告「国家 + 活动 + SKU」短查询  | key-asin-traffic-alert                                                                                  |
| key-asin-traffic-alert              | 重点 ASIN 流量异常诊断报告           | lingxing-ads                                                                                            |
| amazon-pd-analysis-26               | Prime Day 广告复盘（图表 + 报告）    | amazon-targeting-structure-report                                                                       |
| amazon-targeting-structure-report   | 投放结构分析与出价建议               | amazon-pd-analysis-26                                                                                   |
| sqp-brand-analysis                  | SQP 品牌搜索词周报分析               | —                                                                                                       |
| tavily                              | Tavily 网页搜索                      | dtc-market-research                                                                                     |
| dingtalk-fba-alert                  | 库存预警口令（品牌固定话术）         | —                                                                                                       |
| skill-creator                       | 创建 / 更新 skill 的指南             | —                                                                                                       |

## 备注

- 数据表：`company_market_skills`（按 workspace 隔离）
- 当前库中**没有** `amazon-ops`（ops seed 仅在已存在时更新内容）
- 条数会随管理员发布 / 删除变化；更新本文件时以库为准
