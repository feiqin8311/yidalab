# 领星广告短查询（YidaLab）

用 **公司 MCP `company.mcp.lingxing-mcp`** 查已同步的领星广告数据。不要调用 OpenClaw 本机脚本、不要读 `/home/yida/.openclaw/...`。

## 何时激活

用户消息**像广告短查询**时立刻走本 skill / 领星 MCP，不要先闲聊：

- 形态：`国家 + 广告活动(+关键词/定向片段) + SKU`（可残缺）
- 活动段可含中文、英文、`+`、数字、`建议bid1.85` 等
- 例：
  - `美国 80981227+SBV+精准+carbide burr等+建议bid1.85 80981227`
  - `美国 80981227+SBV+精准+carbide burr等+建议bid1.85`
  - `加拿大 某活动名 SKU123`

格式是否完整由查询逻辑消化；你的职责是**识别意图并调 MCP**。

## 国家映射

| 用户说法                                   | country |
| ------------------------------------------ | ------- |
| 美国 / US / USA                            | US      |
| 加拿大 / CA                                | CA      |
| 英国 / UK                                  | UK      |
| 德国 / DE / 欧洲（未特指时先澄清或按活动） | DE 等   |
| 日本 / JP                                  | JP      |

## MCP 工具（`company.mcp.lingxing-mcp`）

先 `activateTools` 激活 `company.mcp.lingxing-mcp`（若尚未可用），再按需调用：

| API                          | 用途                 |
| ---------------------------- | -------------------- |
| `get_schema_summary`         | 看可查表与字段       |
| `query_campaign_ads`         | 国家 + 活动名 + 日期 |
| `query_sku_ads`              | SKU + 日期           |
| `query_asin_ads`             | ASIN + 日期          |
| `query_asin_ad_architecture` | ASIN 广告结构        |
| `query_campaign_querywords`  | 活动搜索词           |
| `query_negative_rules`       | 否定规则             |

日期未说明时：默认近 7～14 天（用当天日期往前推），并在回复里写明窗口。

## 输出要求

1. 用**具体活动名 / SKU / 站点**，少用无法对应的字母代号。
2. 有数据：结构化摘要（花费、曝光、点击、订单 / 销量等已有字段）+ 可执行建议。
3. 无数据：说明查询条件与可能原因（未同步、名称不匹配、国家错），不要编造。
4. 用户要 HTML / 可视化：数据齐后用 `<lobeArtifact type="text/html">`，不要沙箱写 `/home/user`。
5. 用户要 **xlsx/csv 文件** 分享：设备上生成后用 `lobe-dingpan` → `uploadToDingpan`，回 `preview_url`。

## 禁止

- OpenClaw 路径、`upload_to_ops_dingpan.sh`、`LINGXING_ADS_REPO` 兼容层 bash
- 把本路由写进 User Memory
- 未调 MCP 就给「假数据」广告结论
