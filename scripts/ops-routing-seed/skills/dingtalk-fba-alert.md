# LIBRATON 库存预警（YidaLab）

识别固定口令并执行库存预警流程。业务实现可在执行设备上的项目仓库；**交付 / 文件分享**优先用 YidaLab 内置能力，不要写 OpenClaw 记忆路由。

## 触发口令（精确匹配，勿乱扩别名）

| 用户消息                  | 行为                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `LIBRATON库存预警`        | **先不要执行**。回复站点菜单：全部 / 美国 / 加拿大 / 欧洲 / 日本（见下） |
| `LIBRATON库存预警-全部`   | scope=`all` 执行一次                                                     |
| `LIBRATON库存预警-美国`   | scope=`us`                                                               |
| `LIBRATON库存预警-加拿大` | scope=`ca`                                                               |
| `LIBRATON库存预警-欧洲`   | scope=`eu`                                                               |
| `LIBRATON库存预警-日本`   | scope=`jp`                                                               |

菜单文案（仅对裸口令 `LIBRATON库存预警`）：

```text
请选择站点：
1. LIBRATON库存预警-全部
2. LIBRATON库存预警-美国
3. LIBRATON库存预警-加拿大
4. LIBRATON库存预警-欧洲
5. LIBRATON库存预警-日本
```

## 执行原则

1. **仅**在用户明确选择带站点后缀的口令后执行；裸口令只回菜单。
2. 用户说「测试 /dry-run/ 不要发钉钉」→ dry-run，不真发。
3. 需要跑设备侧脚本时：用执行设备 / `runCommand`（设备在线），工作目录为公司配置的 `dingtalk-fba-bot` 检出路径（由环境或运维约定，**不要**写死 `/home/yida/.openclaw/...`）。
4. 若项目支持 `--notify-user-id`：仅当会话元数据有可信 sender 时传入；没有则说明限制，勿默默用别人的默认 userId。
5. **不要**用 scheduler 常驻，除非用户明确要求定时任务。

## 交付

- 项目自带钉钉推送：成功 / 失败如实汇报。
- 若只生成了本地 Excel / 报告文件、需要给用户链接：用内置 **`lobe-dingpan` → `uploadToDingpan`**，回 `preview_url`。
- 禁止 OpenClaw 的 `DINGTALK_FILE` marker、`upload_to_ops_dingpan.sh`。

## 失败处理

- 缺 env / 依赖 / 设备离线：说清楚缺什么，不要假装已发送。
- 不在 dry-run 与 live 之间静默切换。
