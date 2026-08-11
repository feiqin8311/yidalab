ALTER TABLE "business_function_runs" ADD COLUMN IF NOT EXISTS "result_html" text;--> statement-breakpoint
ALTER TABLE "business_function_runs" ADD COLUMN IF NOT EXISTS "result_meta" jsonb;--> statement-breakpoint
ALTER TABLE "business_function_runs" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "business_function_runs" ADD COLUMN IF NOT EXISTS "topic_id" text;--> statement-breakpoint
ALTER TABLE "business_function_runs" ADD COLUMN IF NOT EXISTS "operation_id" text;--> statement-breakpoint
ALTER TABLE "business_function_runs" ADD COLUMN IF NOT EXISTS "assistant_message_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_ws_fn_created_idx" ON "business_function_runs" USING btree ("workspace_id","function_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_operation_id_idx" ON "business_function_runs" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_function_runs_topic_id_idx" ON "business_function_runs" USING btree ("topic_id");
