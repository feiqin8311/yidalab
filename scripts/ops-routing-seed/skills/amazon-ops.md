# 亚马逊运营路由（YidaLab）

公司运营场景路由手册。用户给「站点 + ASIN / 关键词 / 类目 + 时间 + 目标」时按下列意图选 skill/MCP；固定口令直接匹配。

**交付**：中文 HTML 报告优先；交付面走 Inbox 规则（Artifact 预览 vs `lobe-dingpan.uploadHtmlToDingpan`）。禁止把 Artifacts / Memory 当成业务 skill 介绍。

## 意图 → 能力

| 用户说法 / 场景                                 | 优先调用                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| ASIN 流量诊断、自然 / 广告归因、关键词排名异常  | `company.mcp.sif-mcp` + 领星 MCP/skill；必要时 SellerSprite / Amazon 搜索 |
| 广告结构、Campaign / Search Term、否词          | `lingxing-ads` skill 或 `company.mcp.lingxing-mcp`                        |
| 领星短格式：`美国 活动名 SKU` / `国家+活动+SKU` | **仅** `lingxing-ads` → MCP `analyze_campaign` → 固定八段，禁止散文复盘   |
| 类目大盘、淡旺季、BSR、新品机会、关键词机会     | SellerSprite + Sorftime + SIF；有则 activate 对应 company skill           |
| Listing 诊断、Rufus/Alexa 友好、标题五点改写    | listing /rufus auditor company skills + Amazon 采集                       |
| 评论 / VOC / 痛点 / 使用场景                    | Amazon reviews + user-pain-miner / research skills                        |
| 竞品拆解、七图、主图视觉                        | DTC / 竞品 visual skills + 视觉模型 + product detail                      |
| 站外品牌声量、社媒口碑（美国）                  | `dtc-market-research` 族                                                  |
| 推广节奏复盘、价格 / 广告 / 排名时间线          | SIF + 领星 + Amazon 采集 + SellerSprite                                   |
| 库存预警固定口令（LIBRATON/EZARC/YPLUS…）       | `dingtalk-fba-alert`（见该 skill）                                        |

## 输入字段（尽量要齐）

- 站点（US/DE/… 或 美国站）
- ASIN / 关键词 / 类目词 / 品牌名
- 时间范围（近 7/14/30 天等）
- 目标（归因 / 机会 / 改写 / 报告）
- 输出格式（默认中文 HTML）

缺关键字段时先问 1～2 个，不要空跑全链路。

## 可复制流程骨架

### 1. 流量诊断

1. SIF：广告 vs 自然、异常窗口、关键词
2. 领星：Campaign / Ad Group / Keyword / Search Term
3. 验证：自然位 / 广告位、竞品
4. 输出：根因排序 + 优先级动作 + HTML

### 2. 类目 / 新品

1. 类目规模、淡旺季、头部垄断
2. ABA / 搜索量 / 竞争度、BSR Top
3. 机会表 + 风险 + HTML

### 3. Listing / Rufus

1. 搜索意图覆盖缺口
2. AI 问答召回
3. 标题 / 五点 / A+/ 图片可替换文案 + HTML

### 4. VOC

1. 抓评论（星级 / 时间）
2. 痛点分类 + 好评卖点
3. 产品改进与 Listing 映射 + HTML

### 5. 竞品 + 七图

1. 详情 / 价格 / 评分 / 变体
2. 七图视觉（视觉模型）
3. 差异化与我方图片脚本 + HTML

### 6. DTC 站外（美国）

1. activate DTC skill
2. 社媒 / 公开讨论 / 营销动作
3. 中文 HTML 调研报告

## 输出纪律

- 结论先行，再证据链，再动作清单
- 广告活动名用**全称**
- 数据不足标「数据不足」，勿编造
- HTML 交付遵守平台 Artifact / 钉盘规则；IM（钉钉）默认钉盘链接
