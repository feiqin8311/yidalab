CREATE TABLE IF NOT EXISTS "business_function_result_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"view_id" text NOT NULL,
	"row_key" text NOT NULL,
	"search_text" text,
	"sort_orders" double precision,
	"sort_spend" double precision,
	"sort_score" double precision,
	"sort_rank" double precision,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_function_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"function_type" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"main_asin" text,
	"category_name" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"stage" text DEFAULT 'draft' NOT NULL,
	"cancel_requested" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb,
	"summary" jsonb,
	"error" jsonb,
	"export_info" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_function_result_rows" DROP CONSTRAINT IF EXISTS "business_function_result_rows_run_id_business_function_runs_id_fk";
ALTER TABLE "business_function_result_rows" ADD CONSTRAINT "business_function_result_rows_run_id_business_function_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."business_function_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_function_result_rows" DROP CONSTRAINT IF EXISTS "business_function_result_rows_user_id_users_id_fk";
ALTER TABLE "business_function_result_rows" ADD CONSTRAINT "business_function_result_rows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_function_result_rows" DROP CONSTRAINT IF EXISTS "business_function_result_rows_workspace_id_workspaces_id_fk";
ALTER TABLE "business_function_result_rows" ADD CONSTRAINT "business_function_result_rows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_function_runs" DROP CONSTRAINT IF EXISTS "business_function_runs_user_id_users_id_fk";
ALTER TABLE "business_function_runs" ADD CONSTRAINT "business_function_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_function_runs" DROP CONSTRAINT IF EXISTS "business_function_runs_workspace_id_workspaces_id_fk";
ALTER TABLE "business_function_runs" ADD CONSTRAINT "business_function_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_function_result_rows_run_view_key_uidx" ON "business_function_result_rows" USING btree ("run_id","view_id","row_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_result_rows_run_view_idx" ON "business_function_result_rows" USING btree ("run_id","view_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_result_rows_workspace_id_idx" ON "business_function_result_rows" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_result_rows_user_id_idx" ON "business_function_result_rows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_result_rows_search_text_idx" ON "business_function_result_rows" USING btree ("search_text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_user_id_idx" ON "business_function_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_workspace_id_idx" ON "business_function_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_status_idx" ON "business_function_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_function_type_idx" ON "business_function_runs" USING btree ("function_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_workspace_asin_idx" ON "business_function_runs" USING btree ("workspace_id","main_asin");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_created_at_idx" ON "business_function_runs" USING btree ("created_at");
