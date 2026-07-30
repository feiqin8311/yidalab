-- Optional concurrent index variant for large prod (run OUTSIDE a transaction).
--
-- IMPORTANT: If 0125 already ran with plain CREATE INDEX, these IF NOT EXISTS lines
-- will NO-OP (indexes already exist under the same names). Concurrent creation only
-- helps when indexes were intentionally omitted from the base migration.
--
-- Fresh large-prod path:
--   1. Apply 0125 CREATE TABLE / ALTER / FK only (or accept short lock on small DBs).
--   2. Run this file with CONCURRENTLY for indexes.
--   3. Apply 0126.
--
-- Example:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f packages/database/migrations/0125_file_workbook_structured_assets_concurrently.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS "files_parse_status_idx" ON "files" USING btree ("parse_status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_workbooks_file_id_idx" ON "file_workbooks" USING btree ("file_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_workbooks_user_id_idx" ON "file_workbooks" USING btree ("user_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_workbooks_workspace_id_idx" ON "file_workbooks" USING btree ("workspace_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_workbooks_status_idx" ON "file_workbooks" USING btree ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_sheet_assets_file_id_idx" ON "file_sheet_assets" USING btree ("file_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_sheet_assets_workbook_id_idx" ON "file_sheet_assets" USING btree ("workbook_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "file_sheet_assets_user_id_idx" ON "file_sheet_assets" USING btree ("user_id");
