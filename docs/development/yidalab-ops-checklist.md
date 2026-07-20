# YidaLab runtime checklist（部署注意）

1. **钉钉免登**：配置 `AUTH_DINGTALK_APP_KEY` / `AUTH_DINGTALK_APP_SECRET` / `AUTH_DINGTALK_CORP_ID`（可选 `AUTH_DINGTALK_AGENT_ID`）；与机器人 Client ID 可以是不同应用。
2. **`APP_URL`**：必须是钉钉 Stream 能回推到的地址（生产用公网 HTTPS；本地用 `http://localhost:3010` 即可，Stream 在本机进程内转发）。
3. **机器人 / Bot Gateway**：非 Vercel 默认随 Next 启动；仅当本机不能占 Stream 绑定时设 `ENABLE_BOT_IN_DEV=0`。Agent 渠道需已启用钉钉 provider。
4. **任务定时计划**：进程内每 10 分钟扫一次（对齐原 QStash）；关掉用 `TASK_SCHEDULE_DISPATCH_CRON=0`。生产建议 `REDIS_URL` + `AGENT_RUNTIME_MODE=queue`。
5. **浏览器访问**：默认允许（账号登录）；若强制仅钉钉打开，设 `NEXT_PUBLIC_DINGTALK_ONLY=1`。
