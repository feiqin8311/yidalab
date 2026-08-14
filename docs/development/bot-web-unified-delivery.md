# Bot / Web 统一执行与钉钉交付

## 产品模型

```text
钉钉/IM 消息
    │
    ▼
同一 Agent Runtime（与 Web 同 tools / 同分析深度 / 同 HTML→钉盘）
    │
    ├──► 钉钉：完整 Markdown 回复（主对话面，单条 ≤3500 字自动分片）
    │
    ├──► 钉盘：HTML / 文件报告的真实 preview_url
    │
    └──► Web 话题：持久化执行记录与故障恢复依据
```

**钉钉承载完整对话；Web 话题是持久化底座，不要求用户切换到 Web 才能读取结果。**

## 代码落点

| 层                                          | 职责                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `botPlatformContext`                        | 保持与 Web 相同的工具、上下文预算和分析深度                      |
| Agent run                                   | 与 Web 同一 `execAgent` / tools / `htmlDeliveryMode`             |
| `prepareBotOutboundReply`                   | **唯一** Bot 出口：洗假进度、**系统补钉盘**、保留完整正文        |
| `ensureDingpanDeliverable`                  | 报告类且无成功上传时，用最终回复 HTML 确定性上传钉盘             |
| forceFinish + delivery-only                 | 刹车后保留 `uploadHtmlToDingpan`，禁止再查数                     |
| `AgentBridgeService` + `BotCallbackService` | 完成时只调 `prepareBotOutboundReply`                             |
| DingTalk adapter                            | Markdown；sessionWebhook 优先，OpenAPI 主动发送兜底；3500 字分片 |

## 成功标准

1. 钉钉发起的 run：报告类问题**终态必有**真 `preview_url`，或一句不可恢复失败（无第三种）。
2. 用户可在钉钉读到完整 Markdown 结果；Web 话题只承担持久化和恢复。
3. 钉钉消息：完整正文 + `qr.dingtalk.com` 真链接；无「正在上传…」循环。
4. 失败：明确原因（空输出 / 凭证 / 上传失败），不静默、不谎称步数用完。
5. 报告 HTML / 文件在钉盘交付；可阅读的完整分析正文留在钉钉。

## 非目标

- 钉钉内嵌 Artifact / 富 HTML（平台做不到）。
- 把普通文本伪装成「继续」「重试上传」等不存在的命令。
- 发送者自动等于免登用户（身份平面可另做，与交付统一无关）。
- 「同题再问一遍 Web」与钉钉文案逐字相同（那是两次独立 run）。

## 交付不变量（P0）

1. **系统补交付** `ensureDingpanDeliverable`：`prepareBotOutboundReply` 在报告类且无成功上传时，用最终回复包 HTML 直接调钉盘 runtime。
2. **forceFinish delivery-only**：bot / `htmlDeliveryMode=dingpan` 且尚未上传时，刹车后只保留 `lobe-dingpan`（`DingpanDeliveryManifest`），提示写清 token/steps 原因。
3. 出口层不再假设「模型总会 upload」—— 补链 + 补传是系统职责。
4. **可达性兜底**：sessionWebhook 缺失、HTTP 失败或 HTTP 200 业务失败时，单聊优先按 `senderStaffId`、缺失时按加密 `senderId`，群聊按 `conversationId` 调机器人主动发送 API；两路都失败时记录 operation/topic/thread/sender 和已尝试路径。
5. **连接恢复**：首次连接失败会指数退避重试；运行期每 10 秒发送原生 ping，20 秒未收到 pong、socket 关闭或收到钉钉 `SYSTEM/disconnect` 时自动重连；显式 stop 必须清理心跳并取消待执行的重连。
6. **无 Redis 边界**：进程内 webhook /delivery-target 兜底缓存同时受 TTL 和 1000 条容量上限约束，写入时清理过期项并淘汰最旧会话。
