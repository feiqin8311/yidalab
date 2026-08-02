-- generation_id + sheet format for async double-buffer publish / Parquet path
ALTER TABLE "file_workbooks" ADD COLUMN IF NOT EXISTS "generation_id" text;--> statement-breakpoint
ALTER TABLE "file_sheet_assets" ADD COLUMN IF NOT EXISTS "format" text DEFAULT 'jsonl' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_sheet_assets" ADD COLUMN IF NOT EXISTS "generation_id" text;--> statement-breakpoint
DROP INDEX IF EXISTS "file_sheet_assets_workbook_sheet_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_sheet_assets_workbook_sheet_gen_unique" ON "file_sheet_assets" USING btree ("workbook_id","sheet_name","generation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_workbooks_generation_id_idx" ON "file_workbooks" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_sheet_assets_generation_id_idx" ON "file_sheet_assets" USING btree ("generation_id");
