# Task Scheduler V2 — 运行手册

> 代码正确性、灰度、drain 回退已齐备。本页约束**部署层**与**验收指标**。

## 配置

| 变量                            | 值                                   | 含义                   |
| ------------------------------- | ------------------------------------ | ---------------------- |
| `TASK_SCHEDULER_V2`             | `off` \| `shadow` \| `on` \| `drain` | 调度模式（默认 `off`） |
| `TASK_SCHEDULER_V2_WORKSPACES`  | 空 / `*` / `ws_a,ws_b,_personal_`    | Canary 范围            |
| `TASK_SCHEDULER_V2_INTERVAL_MS` | ≥5000（默认 30000）                  | Sweep 间隔，非产品语义 |

### 配置解析契约

- **`_personal_`**：精确匹配 `workspaceId = null`（个人任务）
- **空字符串 / 未设置 / `*`**：全量（所有 workspace）
- **逗号列表**：自动 **trim**；`Set` 去重；列表中含 `*` 视为全量
- **非 allowlist workspace**：只走 **legacy**；V2 planner/dispatcher 不碰
- **drain 的 open-run 统计**：与当前 allowlist **同一 scope**（`toModelScope`）

### Mode 矩阵

| Mode     | 新 plan         | Dispatch / recover | Legacy（in-scope） | Completion           |
| -------- | --------------- | ------------------ | ------------------ | -------------------- |
| `shadow` | 只算不写 ledger | 否                 | 开                 | 有 attempt 就关      |
| `on`     | 是              | 是                 | **关**             | 是                   |
| `drain`  | **否**          | **是**             | **关**             | 是                   |
| `off`    | 否              | 否                 | 开                 | **仍关已有 attempt** |

Completion 在**任意 mode**下只要存在 ledger attempt 就会写终态 —— 回退时不要关掉回调路径。

---

## 部署硬约束：全副本配置一致

滚动发布期间若同时存在 **shadow 与 on**（或不同 `WORKSPACES`）实例：

- 旧路径与 V2 可能被**不同副本**分别触发
- 同一 workspace 可能短暂双调度

**规则：所有 server 副本的 `TASK_SCHEDULER_V2` 与 `TASK_SCHEDULER_V2_WORKSPACES` 必须完全一致后再接受流量。**

### 推荐切换步骤

1. **全副本统一 `shadow`**
   - 部署 env → 滚动重启 → 确认每台日志含\
     `[task-automation:loop] started — mode=shadow`
   - 跑满 shadow 验收（见下）

2. **Canary：`on` + `WORKSPACES=ws_…`**
   - **先改 env，再协调重启全部副本**（不要边滚边混）
   - 确认每台：`mode=on` 且 allowlist 相同
   - 验证 canary workspace 只出 V2 日志；其它 workspace 仍走 legacy sweep

3. **全量：`on`，去掉或设 `WORKSPACES=*`**
   - 同样：**全副本配置一致后**再滚动

4. **回退：`drain` → `off`**
   1. 全副本设 `TASK_SCHEDULER_V2=drain`（allowlist 保持与 on 时相同 scope）
   2. 重启一致
   3. 连续 **≥2 个 sweep 周期**（默认 2×30s）确认对应 scope `open runs = 0`\
      （日志：`drain complete — open runs = 0; safe to set TASK_SCHEDULER_V2=off`）
   4. 全副本设 `off` 并重启
   5. Completion 保持可用（代码层始终接受已有 attempt 回调）

**禁止**：`on` 直接 `off`（会重新打开 legacy，而 DB 里可能仍有 V2 pending/running）。

---

## Shadow 验收（不要只看 “挂了 24–72h”）

| 指标                                     | 目标                                                    |
| ---------------------------------------- | ------------------------------------------------------- |
| 同一 `dedupeKey`                         | 始终只有一个逻辑 run                                    |
| 同一 `runId` + `attempt`                 | 始终只有一个 `agent_operations` 行（`idempotency_key`） |
| planned vs 旧 due                        | 一致；差异可解释（timezone /overdue/ 配置 revision）    |
| `dispatch_latency_ms`                    | P95 < 60s，P99 < 120s（on 后；shadow 无 dispatch）      |
| `pending_age_ms`                         | 稳态不超过 **2 个 sweep 周期**                          |
| `claim_expired`                          | 稳态 ≈ 0                                                |
| `claim_rebound`                          | 仅故障恢复场景                                          |
| 无 run 的 operation / 长期 running 无 op | 不应出现                                                |

覆盖面（可用合成计划，不必等真实周期）：

- Cron + timezone / DST
- Heartbeat
- at /every（API 写入）
- Event（产品事件 catalog）至少一类

日志关键字：`[task-automation.metric]`、`[task-automation:loop]`。

---

## 发布判断

| 阶段            | 条件                                                    |
| --------------- | ------------------------------------------------------- |
| 全局 shadow     | **GO**（配置一致 + 指标验收）                           |
| 单 workspace on | **GO**（`WORKSPACES` + 全副本一致）                     |
| 全量 on         | shadow 指标 + canary 稳定 + **drain 演练**通过后 **GO** |

---

## 生产上线（YidaLab 日常路径）

```bash
# 1. 合并/推送本分支 → Actions 构建镜像并部署
git push origin codex/yidalab-custom # 或 main

# 2. 生产机 /yida/yidalab/.env 全副本写入（再重启 compose）
TASK_SCHEDULER_V2=shadow
# 不要设 WORKSPACES，或 WORKSPACES=*

# 3. 迁库（若 compose 未自动 migrate，在 lobe 容器内）
docker compose exec lobe bun run db:migrate # 以实际 compose service 名为准

# 4. 状态检查
set -a && source /yida/yidalab/.env && set +a
node scripts/ops/task-scheduler-v2-status.mjs

# 5. Canary on（全副本 env 一致后重启）
TASK_SCHEDULER_V2=on
TASK_SCHEDULER_V2_WORKSPACES=ws_YOUR_CANARY

# 6. 全量 on
TASK_SCHEDULER_V2=on
# unset TASK_SCHEDULER_V2_WORKSPACES

# 7. 回退
TASK_SCHEDULER_V2=drain                            # 与 on 时相同 WORKSPACES
node scripts/ops/task-scheduler-v2-drain-ready.mjs # exit 0 再 off
TASK_SCHEDULER_V2=off
```

## 相关代码

- Mode / canary / drain：`apps/server/src/services/taskAutomation/mode.ts`
- Loop / metrics：`apps/server/src/services/taskAutomation/loop.ts`
- Legacy 硬关断：`scheduleTick` / `heartbeatTick` / `scheduleDispatchSweep` / Local·Redis·QStash scheduler
- DB 测试：`packages/database/vitest.config.pglite.mts` + `taskAutomation*.test.ts`
- Ops：`scripts/ops/task-scheduler-v2-status.mjs` / `task-scheduler-v2-drain-ready.mjs`
