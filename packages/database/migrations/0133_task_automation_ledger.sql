CREATE TABLE IF NOT EXISTS "task_automation_run_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text DEFAULT 'dispatch' NOT NULL,
	"claim_token" text,
	"claimed_by" text,
	"lease_until" timestamp with time zone,
	"operation_idempotency_key" text NOT NULL,
	"operation_id" text,
	"topic_id" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"trigger" text NOT NULL,
	"planned_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dedupe_key" text NOT NULL,
	"automation_revision" integer DEFAULT 0 NOT NULL,
	"missed_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"operation_id" text,
	"topic_id" text,
	"error_code" text,
	"error_message" text,
	"alerted_at" timestamp with time zone,
	"requested_next_check_at" timestamp with time zone,
	"effective_next_check_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "automation_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "schedule_kind" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "schedule_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "schedule_every_seconds" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "schedule_anchor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "overdue_policy" text DEFAULT 'latest';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "event_source_type" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "event_filter" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "event_cooldown_seconds" integer DEFAULT 60;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "pacing_min_seconds" integer DEFAULT 600;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "pacing_max_seconds" integer DEFAULT 86400;--> statement-breakpoint
ALTER TABLE "task_automation_run_attempts" DROP CONSTRAINT IF EXISTS "task_automation_run_attempts_run_id_task_automation_runs_id_fk";--> statement-breakpoint
ALTER TABLE "task_automation_run_attempts" ADD CONSTRAINT "task_automation_run_attempts_run_id_task_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."task_automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_runs" DROP CONSTRAINT IF EXISTS "task_automation_runs_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_automation_runs" ADD CONSTRAINT "task_automation_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_runs" DROP CONSTRAINT IF EXISTS "task_automation_runs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_automation_runs" ADD CONSTRAINT "task_automation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_runs" DROP CONSTRAINT IF EXISTS "task_automation_runs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_automation_runs" ADD CONSTRAINT "task_automation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_automation_run_attempts_run_attempt_uidx" ON "task_automation_run_attempts" USING btree ("run_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_automation_run_attempts_op_idem_uidx" ON "task_automation_run_attempts" USING btree ("operation_idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_run_attempts_run_id_idx" ON "task_automation_run_attempts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_run_attempts_status_lease_idx" ON "task_automation_run_attempts" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_run_attempts_operation_id_idx" ON "task_automation_run_attempts" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_automation_runs_dedupe_key_uidx" ON "task_automation_runs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_runs_task_id_idx" ON "task_automation_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_runs_user_id_idx" ON "task_automation_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_runs_workspace_id_idx" ON "task_automation_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_runs_status_planned_idx" ON "task_automation_runs" USING btree ("status","planned_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_runs_pending_dispatch_idx" ON "task_automation_runs" USING btree ("status","next_attempt_at","planned_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_runs_task_status_idx" ON "task_automation_runs" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_automation_runs_finished_at_idx" ON "task_automation_runs" USING btree ("finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_operations_idempotency_key_uidx" ON "agent_operations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_next_run_at_idx" ON "tasks" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_automation_due_idx" ON "tasks" USING btree ("status","automation_mode","next_run_at");--> statement-breakpoint
UPDATE "tasks" SET "schedule_kind" = 'cron' WHERE "automation_mode" = 'schedule' AND "schedule_pattern" IS NOT NULL AND "schedule_kind" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "next_run_at" = COALESCE("last_heartbeat_at", now()) + make_interval(secs => "heartbeat_interval") WHERE "automation_mode" = 'heartbeat' AND "heartbeat_interval" IS NOT NULL AND "heartbeat_interval" > 0 AND "next_run_at" IS NULL AND "status" NOT IN ('canceled', 'completed', 'failed');--> statement-breakpoint
UPDATE "tasks" SET "next_run_at" = now() WHERE "automation_mode" = 'schedule' AND "schedule_pattern" IS NOT NULL AND "next_run_at" IS NULL AND "status" NOT IN ('canceled', 'completed', 'failed', 'paused', 'running');
