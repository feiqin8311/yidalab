ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "processing_policy" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "persist_reason" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "processing_requested_at" timestamp with time zone;--> statement-breakpoint
-- Legacy rows: keep them visible in the resource browser until audited.
-- Chat on_demand is only written by new createFile paths after this migration.
CREATE INDEX IF NOT EXISTS "files_processing_policy_idx" ON "files" USING btree ("processing_policy");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_processing_policy_parse_status_idx" ON "files" USING btree ("processing_policy","parse_status");
