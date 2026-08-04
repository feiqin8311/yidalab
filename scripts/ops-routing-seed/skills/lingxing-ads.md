# 领星广告查询（YidaLab）

短查询「国家 + 广告活动 + SKU」时使用。数据来自 **公司 MCP `company.mcp.lingxing-mcp`**（勿 OpenClaw / 勿 `readReference`）。

## 必做流程

1. `activateTools` → `company.mcp.lingxing-mcp`
2. **优先一次调用 `analyze_campaign`**（见下），用返回 JSON 填八段
3. **严格按固定八段输出**；禁止自由复盘散文

## 拉数（MCP）

### 首选（国家 + 活动 + SKU）

| 用途           | API                    | 参数                                          |
| -------------- | ---------------------- | --------------------------------------------- |
| **固定分析包** | **`analyze_campaign`** | `campaign_name`、`country`、`sku`（建议必填） |

一次返回（直接映射八段，**不要**再手拼 6 个日期窗）：

- `trend.label`：`持续变差` / `持续变好` / `波动较大`（及 acos 对比）
- `compare_7d` / `compare_14d` / `compare_30d`（各含 `current` / `prev`）
- `sku_14d_all` / `sku_30d_all`、`thresholds`、`campaign_14d`
- `negative_rules_ad`、`negative_rules_ad_groups`（`negative_rules_target` 恒为空，可忽略）
- 持续变差时：`best_week`、`recommended_settings.Bid`

国家可用中文或代码：`美国`/`US`、`加拿大`/`CA`、`英国`/`UK`、`德国`/`DE`、`日本`/`JP`。

示例：

```text
analyze_campaign(
  campaign_name="80FD4021-精准-出单词再投放-0.95-固定",
  country="美国",
  sku="80FD4021"
)
```

### 兜底 / 补充（仅当 analyze 不可用或缺字段）

| 用途         | API                                             |
| ------------ | ----------------------------------------------- |
| 单活动区间   | `query_campaign_ads`                            |
| SKU 全品区间 | `query_sku_ads`                                 |
| ASIN 结构    | `query_asin_ads` / `query_asin_ad_architecture` |
| 搜索词明细   | `query_campaign_querywords`                     |
| 简单否词候选 | `query_negative_rules`                          |

兜底时注意：

- **HARD：单次 `start_date`\~`end_date` 跨度 ≤ 90 天**
- 窗口约定与 `analyze_campaign` 一致：不含今天和昨天，最近窗结束日为**前天**
- 近 7 / 前 7 / 近 14 / 前 14 / 近 30 / 前 30 分窗调用；勿一次拉超 90 天
- 若返回 90 天错误：缩到 ≤90 天重试，禁止原参数连打 3 次

## 核心规则（与钉钉版一致）

### 波动判定（只看 ACoS）

**优先用 `result.trend.label`**，勿自行重算。自算规则：

- 近 7 vs 前 7 **且** 近 14 vs 前 14 都升 → **持续变差**
- 两次都降（持平算变好）→ **持续变好**
- 一升一降 → **波动较大**
- 0 值：前 = 0 近≠0 → 变好；前≠0 近 = 0 → 变差；前 14 有数据且近 14 ACoS=0 → 直接持续变差

### 全品阈值（用 SKU 近 14 天全品）

**优先用 `result.thresholds`**。自算：

- 超高 ACoS = 全品 14d ACoS × 1.5
- 高 ACoS = × 1.2；低 ACoS = × 0.8
- 高 CVR = × 1.2；低 CVR = × 0.8
- 高点击 CPO = 全品 14d CPO × 1.5；低点击 CPO = × 0.5；双倍 CPO = × 2
- 竞价加价上限可参考 `thresholds.bid_up_cap`（全品 14d CPC×1.3）、`bid_zero_order_up_cap`（×1.2）

### 竞价出单（单活动近 14d，Orders>0）

- 低 ACoS（≤低阈值）且 ≥3 单 → bid +5%，上限 = 全品 14d CPC×1.3，5 天 / 次
- 高 ACoS（≥高阈值）且 ≥3 单 → bid -5%，下限 $0.1，3 天 / 次
- 超高 ACoS（≥超高）且 ≥2 单 → bid -10% 或 -$0.1，下限 $0.1，预算 -$10，5 天 / 次
- 其余 → 维持原状

**波动较大**时：列出命中规则，但**竞价建议维持原状、继续观察**（不执行加减价）。

### 竞价不出单（Orders=0）

- CPO > 高点击 → bid -$0.1 或 -10%，下限 $0.1，3 天 / 次
- CPO < 低点击 → bid +$0.05 或 +10%，上限 = 全品 14d CPC×1.2，3 天 / 次
- 其余 → 维持原状

### 否词（词 / ASIN / 其余 都要写全）

- 词：点击 > 双倍 CPO 且 0 单 → 精否
- ASIN：点击 > 高点击 CPO 且 0 单 → 否 ASIN
- **§5 / §6**：用 `negative_rules_ad`（及 target 若有；当前 MCP 不返回 target）
- **§7**：用 `negative_rules_ad_groups`（全品相关广告组）
- 无命中也写「当前无命中… / 维持原状」

## 固定八段输出（强制，标题一字不改）

直接 Markdown，**不要**外包代码块。标题必须是 `## 1) ...`：

```text
## 1) 结论
- 仅一行主结论：持续变差 / 持续变好 / 波动较大
- 括号写近7d vs 前7d、近14d vs 前14d 的 ACoS 与方向
- 方向不一致时结论只能是「波动较大」
- 优先抄 result.trend.label

## 2) 基础数据
### 单活动近7天 vs 前7天
### 单活动近14天 vs 前14天
### 单活动近30天 vs 前30天
（持续变差时追加）### 单活动近30天最佳连续7天
### 全品14天汇总
（有则）### 全品30天汇总
### 阈值
（列出超高/高/低 ACoS、高/低 CVR、高/低/双倍 CPO 数值）

## 3) 规则-竞价出单
- 先写单活动近14d：ACoS / CVR / CPO / Orders
- 完整列出：低 ACoS / 高 ACoS / 超高 ACoS / 其余 四条及动作
- 每条标明当前是否命中；波动较大则最终建议维持原状观察

## 4) 规则-竞价不出单
- 完整列出：高点击 CPO / 低点击 CPO / 其余 三条及动作
- 不适用时写「本节规则不适用」并仍列出原始规则

## 5) 规则-超高点击不出单,关闭原投放
- 完整列出：词 / ASIN / 其余 三条；命中写具体 query

## 6) 规则-单广告活动否词
- 完整列出：词 / ASIN / 其余 三条

## 7) 规则-全品搜索词否词
- 完整列出：词 / ASIN / 其余 三条；命中写 query→精否

## 8) 复原推荐参数
- 仅「持续变差」时输出推荐 Bid 等（可用 recommended_settings）；否则写「非持续变差，本节不适用」
```

字段映射速查：

| 段落             | JSON                                         |
| ---------------- | -------------------------------------------- |
| 1 结论           | `trend`                                      |
| 2 单活动 7/14/30 | `compare_7d` / `compare_14d` / `compare_30d` |
| 2 最佳周         | `best_week`                                  |
| 2 全品           | `sku_14d_all` / `sku_30d_all`                |
| 2 阈值           | `thresholds`                                 |
| 3–4 单活动近 14d | `campaign_14d` 或 `compare_14d.current`      |
| 5–6 否词         | `negative_rules_ad`                          |
| 7 全品否词       | `negative_rules_ad_groups`                   |
| 8 Bid            | `recommended_settings`                       |

格式：

- 子标题 `### ...`；列表 `- ...`；分隔 `---`
- **禁止**把预定义动作改成空白或省略整节
- 无调整也必须写原规则 +「维持原状，保持不变」
- 不编造；金额带货币，ACoS/CTR/CVR 两位 `%`；日期 `YYYY-MM-DD~YYYY-MM-DD`

## 禁止

- 自由复盘（「核心表现 / 搜索词层 / 可执行清单」等非本八段标题）
- `readReference`、OpenClaw、`LINGXING_ADS_REPO` bash
- 未查 MCP 就输出规则结论
- 在 `analyze_campaign` 已成功时仍重复打 6 窗 `query_campaign_ads`（浪费且易超 90 天限制）
