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

| 层                                          | 职责                                                  |
| ------------------------------------------- | ----------------------------------------------------- |
| `botPlatformContext`                        | 明确 IM = 中继；禁止弱化工具、禁止假进度文案          |
| Agent run                                   | 与 Web 同一 `execAgent` / tools / `htmlDeliveryMode`  |
| `prepareBotOutboundReply`                   | **唯一** Bot 出口：洗假进度、补真钉盘链接、压成短回传 |
| `AgentBridgeService` + `BotCallbackService` | 完成时只调 `prepareBotOutboundReply`                  |
| DingTalk adapter                            | 纯 text + 3500 字硬顶（平台限制）                     |

## 成功标准

1. 同题 Web / 钉钉：工具深度与是否 `uploadHtmlToDingpan` 一致。
2. 钉钉消息：短结论 + `qr.dingtalk.com` 真链接；无「正在上传…」循环。
3. 失败：明确一句原因（空输出 / 工具错 / 未上传），不静默。
4. 完整报告只在钉盘 + Web 话题，不在钉钉正文塞 HTML。

## 非目标

- 钉钉内嵌 Artifact / 富 HTML（平台做不到）。
- 发送者自动等于免登用户（身份平面可另做，与交付统一无关）。
