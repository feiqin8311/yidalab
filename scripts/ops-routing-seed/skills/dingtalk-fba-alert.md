# 库存预警（YidaLab → dingtalk-fba-bot）

用户只需发**品牌口令**。按**当前人的钉钉 userId** 只给本人跑 / 发，不要站点菜单，不要设备脚本。

## 触发口令（精确匹配即可执行）

| 用户消息           | 立即执行 | scope   |
| ------------------ | -------- | ------- |
| `LIBRATON库存预警` | 是       | `all`   |
| `EZARC库存预警`    | 是       | `ezarc` |
| `YPLUS库存预警`    | 是       | `yplus` |

- **不要**再回「请选择站点」菜单；口令本身就是指令。
- 用户说 dry-run / 不要发钉钉 → `mode=dry_run`，否则默认 `mode=self`。

## 身份（服务端注入，模型不要传 userId）

| 入口           | 用谁的 userId                                                 |
| -------------- | ------------------------------------------------------------- |
| **钉钉会话**   | 当前消息发送者 `senderId` → `botContext.senderExternalUserId` |
| **本项目前端** | 该 Agent DingTalk 频道**高级设置** Owner `settings.userId`    |

- 只通知 / 只面向这个人（`mode=self`），不按店铺矩阵群发。
- 禁止模型编造 userId；禁止回落 fba-bot 默认广播名单。

## 执行（必须）

1. 认到上表口令后，立刻调内置 tool：\
   **`lobe-fba-alert` → `runFbaAlert({ scope })`**\
   （默认 `mode=upload_only`：上传钉盘并返回 `preview_url`，**不**发钉钉机器人私信；用户要 dry-run 再传 `mode=dry_run`）
2. **禁止** `runCommand`、本地 python、设备侧脚本、OpenClaw、自拼 HTTP。
3. **禁止** `mode=broadcast`（矩阵群发只给服务器定时任务）。
4. 服务端配置：`FBA_ALERT_API_URL` + `FBA_ALERT_API_TOKEN`。

## 汇报

- 成功：在对话里给出 tool 返回的 **`preview_url`（钉盘预览链接）**，并带上 `status` / `alert_count`（与钉盘交付一致）。
- 失败：说清原因（未配 API、job failed、限流重试仍失败等），不要假装已发送。
