# Workbook structured parse — rollout checklist

## 0. Pre-flight (local)

```bash
pnpm install # link @lobechat/builtin-tool-workbook + @duckdb/node-api
bun run check --lint --test packages/file-loaders/src/loaders/excel packages/context-engine/src/utils
# optional: bun run check --type  (repo may have unrelated TS noise)
```

## 1. Schema (prod / staging)

Order:

1. Backup DB (or at least `files`, `documents`, `file_workbooks`, `file_sheet_assets`).

2. Dry-run SQL on a clone if possible.

3. Apply migrations (repo: `bun run db:migrate` with prod env, or apply SQL files):

   - `packages/database/migrations/0125_file_workbook_structured_assets.sql`
   - `packages/database/migrations/0126_file_workbook_generation.sql`
   - Snapshot chain: `meta/0125_snapshot.json` + `meta/0126_snapshot.json` (required for future `drizzle-kit generate`)

4. Large prod (optional): after tables exist, create indexes with `CONCURRENTLY` via\
   `packages/database/migrations/0125_file_workbook_structured_assets_concurrently.sql`\
   (must run **outside** a transaction).

5. Verify:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'files' AND column_name LIKE 'parse%';

SELECT to_regclass('public.file_workbooks'), to_regclass('public.file_sheet_assets');
```

## 2. Deploy image

1. Push branch `codex/yidalab-custom` (or merge path you use).
2. Wait for **YidaLab Production Image** CI → GHCR → SSH deploy.
3. Confirm container has new packages (`builtin-tool-workbook`, async `file.parseWorkbook`, optional DuckDB native).
4. Confirm `APP_URL` / internal JWT works so fire-and-forget async tRPC can reach `/trpc/async`.
5. Optional: `WORKBOOK_PARSE_IN_PROCESS=1` forces in-process parse (debug only — disables child isolation).

## 3. Smoke after deploy

1. Upload a small `.xlsx` (< 5MB).
2. Expect `files.parse_status` → `queued` → `parsing` → `ready` (poll DB or UI).
3. Chat attach: prompt should show **manifest card**, not full grid.
4. Tool: `lobe-workbook` `inspectWorkbook` / `querySheet` returns rows + coverage.
5. Upload a file > 20MB: parse should **fail** with size limit (no OOM).
6. `querySheet` while parsing must **not** block on sync XLSX parse (returns not-ready error + enqueue).

## 4. Stock audit + automated cleanup

Read-only audit: `docs/development/sql/workbook_mega_document_audit.sql`

Automated pipeline (dry-run first):

```bash
# plan only
WORKBOOK_ENQUEUE_USER_ID= scripts/workbook-mega-cleanup.ts < user > bun

# apply: enqueue spreadsheet parse, wait, replace mega spreadsheet docs with cards, cap other mega docs
WORKBOOK_ENQUEUE_USER_ID= scripts/workbook-mega-cleanup.ts < user > bun --apply --wait-ms=180000
```

Manual fallback per file:

| Case                             | Action                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Spreadsheet + original S3 exists | `UPDATE files SET parse_status='uploaded'` then `bun scripts/workbook-enqueue-parse.ts` |
| Mega non-spreadsheet document    | Cap / archive content (script does this with `--apply`)                                 |
| Original missing                 | Keep metadata; mark failed / ask re-upload                                              |

**Order:** backup content → enqueue parse → verify ready assets → replace message/document bodies with card → delete mega text.

Do **not** delete old `documents.content` before parse succeeds.

## 5. Observability (minimum)

- Count by `files.parse_status`
- `async_tasks` where `type='file_parse'` and status
- Container RSS during parse (child process should release after kill)
- Provider context-length errors
- Count `documents` with `length(content) > 80000`

## 6. Closed in this ship

- Child-process XLSX parse (`workbookParseWorker.cjs`) — timeout **SIGKILL**s child (no soft `Promise.race`)
- Publish flag: catch never deletes **current** generation after ready
- Large sheets: Parquet write + DuckDB query when `@duckdb/node-api` loads; else JSONL + line-stream query
- Query path never sync-parses XLSX; enqueues async instead
- Migration `0126_snapshot.json` restored for Drizzle chain
- `scripts/workbook-mega-cleanup.ts` for stock mega docs
- Optional concurrent index SQL for large prod
