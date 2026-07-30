# Workbook structured parse — rollout checklist

## 0. Pre-flight (local)

```bash
pnpm install # link @lobechat/builtin-tool-workbook
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

4. Verify:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'files' AND column_name LIKE 'parse%';

SELECT to_regclass('public.file_workbooks'), to_regclass('public.file_sheet_assets');
```

Large prod: prefer creating indexes with `CONCURRENTLY` outside a transaction if lock time is a concern (0125 uses plain `CREATE INDEX IF NOT EXISTS`).

## 2. Deploy image

1. Push branch `codex/yidalab-custom` (or merge path you use).
2. Wait for **YidaLab Production Image** CI → GHCR → SSH deploy.
3. Confirm container has new packages (`builtin-tool-workbook`, async `file.parseWorkbook`).
4. Confirm `APP_URL` / internal JWT works so fire-and-forget async tRPC can reach `/trpc/async`.

## 3. Smoke after deploy

1. Upload a small `.xlsx` (< 5MB).
2. Expect `files.parse_status` → `queued` → `parsing` → `ready` (poll DB or UI).
3. Chat attach: prompt should show **manifest card**, not full grid.
4. Tool: `lobe-workbook` `inspectWorkbook` / `querySheet` returns rows + coverage.
5. Upload a file > 20MB: parse should **fail** with size limit (no OOM).

## 4. Stock audit + backfill

Run audit SQL: `docs/development/sql/workbook_mega_document_audit.sql`

Then:

| Case                             | Action                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Spreadsheet + original S3 exists | `UPDATE files SET parse_status='uploaded'` then re-enqueue via re-upload or admin enqueue |
| Mega non-spreadsheet document    | Cap / archive content; do not force workbook path                                         |
| Original missing                 | Keep metadata; mark failed / ask re-upload                                                |

**Order:** backup content → enqueue parse → verify ready assets → replace message/document bodies with card → delete mega text.

Do **not** delete old `documents.content` before parse succeeds.

## 5. Observability (minimum)

- Count by `files.parse_status`
- `async_tasks` where `type='file_parse'` and status
- Container RSS during parse
- Provider context-length errors
- Count `documents` with `length(content) > 80000`

## 6. Later (true close)

- Dedicated parse worker process/container + memory cap + zip-bomb checks
- Parquet write + DuckDB query (`format='parquet'`)
- Index `CONCURRENTLY` migration variant
