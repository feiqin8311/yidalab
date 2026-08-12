CREATE TABLE IF NOT EXISTS "delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"delivery_type" text NOT NULL,
	"target_folder" text DEFAULT 'default' NOT NULL,
	"artifact_hash" text DEFAULT 'report' NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claim_token" text,
	"claimed_by" text,
	"lease_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"file_id" text,
	"space_id" text,
	"preview_url" text,
	"artifact_id" text,
	"error_code" text,
	"error_message" text,
	"retryable" boolean DEFAULT true NOT NULL,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "outcome_status" text;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "outcome_type" text;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "outcome_preview_url" text;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "outcome_artifact_id" text;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "outcome_error_code" text;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "outcome_retryable" boolean;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "outcome_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_attempts" DROP CONSTRAINT IF EXISTS "delivery_attempts_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" DROP CONSTRAINT IF EXISTS "delivery_attempts_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_attempts_dedupe_uidx" ON "delivery_attempts" USING btree ("operation_id","delivery_type","target_folder","artifact_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_attempts_dedupe_key_uidx" ON "delivery_attempts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_attempts_operation_id_idx" ON "delivery_attempts" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_attempts_status_next_idx" ON "delivery_attempts" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_attempts_user_id_idx" ON "delivery_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_attempts_workspace_id_idx" ON "delivery_attempts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_outcome_status_idx" ON "agent_operations" USING btree ("outcome_status");
