# Context platform notes (Excel + beyond)

## Must-have contracts (this change set)

1. **Four views** — `ToolExecutionResult` (`@lobechat/types`): `modelView` / `uiView` / `artifact?` / `telemetryView`. Builtin tools may set `BuiltinServerRuntimeOutput.executionResult`.
2. **ContextItem** — `createContextItem` / `assembleContextItems` / `createFileManifestContextItem` in `@lobechat/context-engine`. File cards are `kind: 'file_manifest'`, trust `external`, memory `deny`.
3. **External trust** — Excel / web / MCP default `EXTERNAL_TRUST` (`memoryPolicy: 'deny'`). Do not write cell text into long-term memory.
4. **ArtifactRef** — `PlatformArtifactRef` for future S3-backed full results; chat/messages only store ids.
5. **Provenance** — workbook tools return `source` + `coverage` + `truncated` + `nextCursor` + `queryHash`.
6. **ContextTrace** — `buildContextTraceSnapshot` for per-step budget audit.
7. **Diagnostics** — `ResolvedAttachments.diagnostics` so one workbook parse fail does not kill the turn.

## Context budget gate (wired)

- `MessagesEngine` seeds pipeline `metadata.maxTokens` = `contextWindowTokens - outputReserve` (default reserve 8192; unknown window → 100k).
- `serverCallLlmContextHints` resolves `contextWindowTokens` from model-bank card → `serverMessagesEngine`.
- `MessageContentProcessor`: conservative CJK-aware estimate → soft strip `<file>` bodies → **re-count** → hard **abort** (`CONTEXT_BUDGET_EXCEEDED`) if still over.
- Strip and reject are no longer the same action.

## Excel path (async-first)

```
upload createFile
  → files.parse_status=queued + async_tasks type=file_parse
  → HTTP async worker file.parseWorkbook
  → claim generationId → parse → write assets under generation
  → DB flip ready (same generation) → delete previous generation S3/rows
```

- **App thread does not parse XLSX** on upload / chat attach / inspect (status card only until ready)
- Assets owned by **file.userId**; query by fileId + current generationId
- Sheet `format`: `jsonl` (now) | `parquet` (reserved; query throws until DuckDB wired)
- Claim/lease + generation double-buffer; failed cool-down 2m
- In-worker limits: **20MB**, **2M** cells, **64MB** JSONL, concurrency=1 slot
- Query: sort raw then project; coverageLimited; single-row clamp; valid JSON modelView

## Rollout phases

See **`docs/development/workbook-rollout-checklist.md`** and audit SQL
`docs/development/sql/workbook_mega_document_audit.sql`.

1. Migration 0125+0126 (schema) — dry-run; prefer CONCURRENTLY for large indexes on prod
2. Deploy image with async `file.parseWorkbook` + enqueue on `createFile` + old-read compat
3. Backfill: audit mega documents → re-enqueue → swap cards → archive old content
4. Cleanup: drop mega `documents.content`, retire Excel markdown loader

Ops enqueue: `WORKBOOK_ENQUEUE_USER_ID=... bun scripts/workbook-enqueue-parse.ts <fileId>`

## Platform follow-ups

- Dedicated Worker container + `--max-old-space-size` + zip-bomb checks (current: same-process async tRPC)
- Parquet write + DuckDB structured query (format flag ready)
- Migration indexes `CONCURRENTLY`
- WorkbookService integration tests (claim race, S3 fail, generation swap)
- Observability: queue depth, parse RSS, gate hits, mega-doc remaining
