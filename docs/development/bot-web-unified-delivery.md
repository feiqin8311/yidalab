# Bot / Web 统一交付（最终方案）

## 产品模型

```text
钉钉/IM 消息
    │
    ▼
同一 Agent Runtime（与 Web 同 tools / 同分析深度 / 同 HTML→钉盘）
    │
    ├──► Web 话题：完整中间过程 + 完整报告（权威结果）
    │
    └──► IM 回传：短结论 + 真实钉盘 preview_url
         （钉钉不能渲染 Artifact / 内嵌 HTML）
```

**统一的是大脑（Agent 执行），不同的只是外壳（展示 / 回传）。**

## 代码落点

| 层                                          | 职责                                                    |
| ------------------------------------------- | ------------------------------------------------------- |
| `botPlatformContext`                        | 明确 IM = 中继；禁止弱化工具、禁止假进度文案            |
| Agent run                                   | 与 Web 同一 `execAgent` / tools / `htmlDeliveryMode`    |
| `prepareBotOutboundReply`                   | **唯一** Bot 出口：洗假进度、**系统补钉盘**、压成短回传 |
| `ensureDingpanDeliverable`                  | 报告类且无成功上传时，用最终回复 HTML 确定性上传钉盘    |
| forceFinish + delivery-only                 | 刹车后保留 `uploadHtmlToDingpan`，禁止再查数            |
| `AgentBridgeService` + `BotCallbackService` | 完成时只调 `prepareBotOutboundReply`                    |
| DingTalk adapter                            | 纯 text + 3500 字硬顶（平台限制）                       |

## 成功标准

1. 钉钉发起的 run：报告类问题**终态必有**真 `preview_url`，或一句不可恢复失败（无第三种）。
2. 权威结果 = **该 bot 话题**（勿拿「再问一遍 Web」当复现）。
3. 钉钉消息：短结论 + `qr.dingtalk.com` 真链接；无「正在上传…」循环。
4. 失败：明确原因（空输出 / 凭证 / 上传失败），不静默、不谎称步数用完。
5. 完整报告只在钉盘 + Web 话题，不在钉钉正文塞 HTML。

## 非目标

- 钉钉内嵌 Artifact / 富 HTML（平台做不到）。
- 发送者自动等于免登用户（身份平面可另做，与交付统一无关）。
- 「同题再问一遍 Web」与钉钉文案逐字相同（那是两次独立 run）。

## 交付不变量（P0）

1. **系统补交付** `ensureDingpanDeliverable`：`prepareBotOutboundReply` 在报告类且无成功上传时，用最终回复包 HTML 直接调钉盘 runtime。
2. **forceFinish delivery-only**：bot / `htmlDeliveryMode=dingpan` 且尚未上传时，刹车后只保留 `lobe-dingpan`（`DingpanDeliveryManifest`），提示写清 token/steps 原因。
3. 出口层不再假设「模型总会 upload」—— 补链 + 补传是系统职责。
