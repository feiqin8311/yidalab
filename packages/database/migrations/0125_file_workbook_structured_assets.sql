CREATE TABLE IF NOT EXISTS "file_sheet_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workbook_id" text NOT NULL,
	"file_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"sheet_name" text NOT NULL,
	"sheet_index" integer DEFAULT 0 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"column_count" integer DEFAULT 0 NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_key" text,
	"inline_jsonl" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_workbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"parser_version" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"sheet_count" integer DEFAULT 0 NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"token_estimate" integer,
	"manifest" jsonb,
	"error" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "parse_status" text DEFAULT 'uploaded';--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "parse_error" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "parser_version" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "parse_task_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "parsed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_sheet_assets" ADD CONSTRAINT "file_sheet_assets_workbook_id_file_workbooks_id_fk" FOREIGN KEY ("workbook_id") REFERENCES "public"."file_workbooks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_sheet_assets" ADD CONSTRAINT "file_sheet_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_sheet_assets" ADD CONSTRAINT "file_sheet_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_sheet_assets" ADD CONSTRAINT "file_sheet_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_workbooks" ADD CONSTRAINT "file_workbooks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_workbooks" ADD CONSTRAINT "file_workbooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_workbooks" ADD CONSTRAINT "file_workbooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_sheet_assets_workbook_sheet_unique" ON "file_sheet_assets" USING btree ("workbook_id","sheet_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_sheet_assets_file_id_idx" ON "file_sheet_assets" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_sheet_assets_workbook_id_idx" ON "file_sheet_assets" USING btree ("workbook_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_sheet_assets_user_id_idx" ON "file_sheet_assets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_workbooks_file_id_parser_version_unique" ON "file_workbooks" USING btree ("file_id","parser_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_workbooks_file_id_idx" ON "file_workbooks" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_workbooks_user_id_idx" ON "file_workbooks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_workbooks_workspace_id_idx" ON "file_workbooks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_workbooks_status_idx" ON "file_workbooks" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "files" ADD CONSTRAINT "files_parse_task_id_async_tasks_id_fk" FOREIGN KEY ("parse_task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_parse_status_idx" ON "files" USING btree ("parse_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_parse_task_id_idx" ON "files" USING btree ("parse_task_id");
