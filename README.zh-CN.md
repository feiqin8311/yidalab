# YidaLab

企业内部 AI Agent 工作台，基于 [LobeHub](https://github.com/lobehub/lobehub) 二次开发。

**仓库：** <https://github.com/feiqin8311/yidalab>\
**English:** [README.md](./README.md)

## 这是什么

YidaLab 是面向公司场景的 LobeHub 定制版，主要包括：

- 钉钉免登 / 机器人 Bot Gateway
- 钉盘工具、HTML 导出上传
- 默认走 Redis 内部任务（QStash 可选）
- 品牌、服务模型、访问门禁等内部试点定制

**不是**上游公开产品。请勿沿用 LobeHub 官方徽章 / Discord / Product Hunt 链接。

## 文档（从这里开始）

| 文档                                                                                                       | 用途                                |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| [docs/development/yidalab-ops-checklist.md](./docs/development/yidalab-ops-checklist.md)                   | 部署 / 钉钉 / 机器人 / 定时任务清单 |
| [docs/development/pilot-invite.md](./docs/development/pilot-invite.md)                                     | 内部试用邀请文案                    |
| [docs/development/basic/setup-development.zh-CN.mdx](./docs/development/basic/setup-development.zh-CN.mdx) | 本地开发环境（上游风格说明）        |

## 本地开发

```bash
pnpm install
bun run dev:docker # 如使用 compose 基础设施
bun run db:migrate

# 全栈（Next API ~3010 + SPA）
bun run dev

# 仅 SPA（Vite，API 代理到 localhost:3010）
bun run dev:spa
```

常用地址：

- 应用 / API：`http://localhost:3010`
- SPA 开发：`http://localhost:9876`
- 局域网：用本机 IP，如 `http://192.168.x.x:9876`（登录回调需匹配时改 `APP_URL`）

## YidaLab 环境变量（最少）

完整清单见运维 checklist。常用项：

```bash
APP_URL=http://localhost:3010

AUTH_DINGTALK_APP_KEY=
AUTH_DINGTALK_APP_SECRET=
AUTH_DINGTALK_CORP_ID=
# AUTH_DINGTALK_AGENT_ID=

# 可选：仅允许钉钉内打开
# NEXT_PUBLIC_DINGTALK_ONLY=1

# 可选：本地不启 Bot Stream
# ENABLE_BOT_IN_DEV=0

# 可选：关闭匿名用量上报
# TELEMETRY_DISABLED=1
```

## 分支

本仓库产品分支：`main`（`feiqin8311/yidalab`）。\
上游 LobeHub 开发分支为 `canary`（remote：`upstream`）。

## 许可 / 上游

基于 LobeHub，见 [LICENSE](./LICENSE)。\
上游：<https://github.com/lobehub/lobehub>
