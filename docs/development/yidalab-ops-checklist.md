# YidaLab runtime checklist（部署注意）

> 宣布 **v1.0-internal** 上线前，另走完整放行表：\
> [v1-internal-release-gate.md](./v1-internal-release-gate.md)

1. **钉钉免登**：配置 `AUTH_DINGTALK_APP_KEY` / `AUTH_DINGTALK_APP_SECRET` / `AUTH_DINGTALK_CORP_ID`（可选 `AUTH_DINGTALK_AGENT_ID`）；与机器人 Client ID 可以是不同应用。
2. **钉盘 OpenAPI**（可与免登不同应用）：公司凭证 key `dingtalk` 填 `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET`；每人个人凭证 `dingtalk-dingpan` 填 folder + userId/unionId。
3. **`APP_URL`**：必须是钉钉 Stream 能回推到的地址（生产用公网 HTTPS；本地用 `http://localhost:3010` 即可，Stream 在本机进程内转发）。
4. **机器人 / Bot Gateway**：非 Vercel 默认随 Next 启动；仅当本机不能占 Stream 绑定时设 `ENABLE_BOT_IN_DEV=0`。Agent 渠道需已启用钉钉 provider。
5. **任务定时计划（legacy）**：进程内每 10 分钟扫一次（对齐原 QStash）；关掉用 `TASK_SCHEDULE_DISPATCH_CRON=0`。生产建议 `REDIS_URL` + `AGENT_RUNTIME_MODE=queue`。
6. **任务调度 V2**：`TASK_SCHEDULER_V2=off|shadow|on|drain`；灰度 `TASK_SCHEDULER_V2_WORKSPACES`。**全副本 mode/allowlist 必须一致**。回退路径 `on → drain → off`。完整 runbook：\
   [task-scheduler-v2-runbook.md](./task-scheduler-v2-runbook.md)
7. **浏览器访问**：默认允许（账号登录）；若强制仅钉钉打开，设 `NEXT_PUBLIC_DINGTALK_ONLY=1`。
