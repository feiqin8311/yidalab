# Trusted Delivery Closed-Loop (YidaLab)

> 模型说「完成」≠ 系统成功。只有结果已持久化并验证后，Operation 才能进入 verified outcome。

## North star

```
系统价值 =
  可验证完成次数 × 正确率 × 可恢复率
  ────────────────────────────
  用户等待时间 × 模型成本 × 运维复杂度
```

Metrics:

| Metric                    | Meaning                            |
| ------------------------- | ---------------------------------- |
| Verified Outcome Rate     | 有效回答 / 钉盘可打开文件 占比     |
| Cost per Verified Outcome | 每有效成果的模型 + 工具 + 基建成本 |
| Time to Outcome           | 用户发送 → 成果可用                |
| Silent Failure Rate       | UI 成功但实际未完成 → **目标 0**   |

## Architecture

```
accepted → queued → running → waiting_for_tool|user → delivering
  → succeeded | failed | canceled | timed_out
```

Delivery is a **separate stage** from agent completion:

```
Agent 完成
  → enqueue delivery_attempts (dedupe)
  → claim + upload
  → verify preview_url / file metadata
  → persist fileId/spaceId/previewUrl
  → record agent_operations.outcome_* = verified
  → UI/Bot 宣布成功
```

### Uniqueness

```
(operationId, deliveryType, targetFolder, artifactHash)
```

Helper: `dingpanDeliveryDedupeKey(operationId)` →\
`op_xxx:dingpan-report:default:report`

### Tables / columns

- `delivery_attempts` — durable outbox (claim/lease, retry, verification)
- `agent_operations.outcome_status|type|preview_url|artifact_id|error_code|retryable|verified_at`

Migration: `0134_delivery_attempts_and_outcome`

### Authority

- Tool messages + outbox rows only (`deliveryClaimGuard`)
- Never assistant prose
- `ensureDingpanDeliverable` enqueues outbox before upload

## Prod gate

`.github/workflows/yidalab-prod-image.yml` health check **must fail** the deploy job when readiness is never reached (no more `exit 0` after retries).

## Smoke

```bash
# API/credential smoke (existing)
node scripts/ops/smoke-dingpan-v1.mjs

# Product-path gates: schema + upload + claim guard
node scripts/ops/smoke-dingpan-product-path.mjs
node scripts/ops/smoke-dingpan-product-path.mjs --dry-run
```

## Resident workers

| Worker             | Env                           | Role                                       |
| ------------------ | ----------------------------- | ------------------------------------------ |
| Delivery drain     | `DELIVERY_DRAIN=0` to disable | Re-verify pending outbox via tool messages |
| Task automation V2 | `TASK_SCHEDULER_V2`           | Existing                                   |

Started from `src/instrumentation.ts` when `shouldRunResidentWorkers()`.

## Repair API (TRPC `dingpan`)

- `listDeliveries({ operationId })`
- `redriveDelivery({ id, force? })`
- `listDeadLetters({ limit? })`

## Metrics

Structured log lines: `[delivery.metric] name=value labels…`\
Names: `enqueue`, `claim`, `succeeded`, `failed`, `redrive`, `pending_age_ms`, `drain_batch`, `dead_letter`.

## Build budgets

`scripts/buildMetrics.mts` enforces MiB caps (override via `YIDALAB_BUDGET_*_MIB`, `0` disables).

## Prod deploy

- Health fail → job fails + **auto-rollback** to previous image id when known
- `yidalab-prod-verify` checks `delivery_attempts` + `outcome_status`

## Initial SLO targets (revise after 1 week baseline)

| SLO                                          | Target  |
| -------------------------------------------- | ------- |
| Operation reaches terminal state in deadline | ≥ 99.5% |
| Dingpan delivery success                     | ≥ 99%   |
| Duplicate execution rate                     | < 0.1%  |
| Disconnect recovery                          | ≥ 99%   |
| Silent failure rate                          | **0**   |
| Non-model internal P95                       | < 1s    |

## Sprint status

1. ✅ Outcome contract + prod health gate + migration
2. ✅ Outbox + model-tool path + product smoke + auto-rollback
3. ✅ Dingpan card loading/error + primary “打开钉盘文件”
4. ✅ Delivery drain worker + redrive API
5. ✅ Build hard budgets
6. ⏳ Split largest core services (deferred — needs behavior locks)

## Code map

| Concern          | Path                                                          |
| ---------------- | ------------------------------------------------------------- |
| Outcome types    | `packages/types/src/operationOutcome.ts`                      |
| Outbox schema    | `packages/database/src/schemas/deliveryAttempt.ts`            |
| Outbox model     | `packages/database/src/models/deliveryAttempt.ts`             |
| Op outcome write | `AgentOperationModel.recordOutcome`                           |
| Model-tool close | `apps/server/src/services/delivery/recordModelToolOutcome.ts` |
| Drain loop       | `apps/server/src/services/delivery/loop.ts`                   |
| Bot delivery     | `apps/server/src/services/bot/ensureDingpanDeliverable.ts`    |
| Claim guard      | `packages/agent-runtime/src/utils/deliveryClaimGuard.ts`      |
| UI card          | `packages/builtin-tools/src/dingpan/UploadHtmlRender.tsx`     |
| Prod health      | `.github/workflows/yidalab-prod-image.yml`                    |
