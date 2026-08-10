CREATE TABLE IF NOT EXISTS "agent_runtime_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"step_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"reason" text,
	"agent_state" jsonb NOT NULL,
	"context_manifest" jsonb,
	"pending_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_intervention" jsonb,
	"created_at_event" timestamp with time zone NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runtime_execution_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_operation_id" text NOT NULL,
	"child_operation_id" text NOT NULL,
	"call_id" text NOT NULL,
	"relationship" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runtime_interventions" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"intervention_id" text NOT NULL,
	"step_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"resolved_by_command_id" text,
	"created_at_event" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runtime_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"event_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"turn_id" text,
	"step_id" text,
	"event_timestamp" timestamp with time zone NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runtime_journal_counters" (
	"operation_id" text PRIMARY KEY NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runtime_checkpoints" DROP CONSTRAINT IF EXISTS "agent_runtime_checkpoints_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runtime_checkpoints" ADD CONSTRAINT "agent_runtime_checkpoints_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runtime_execution_edges" DROP CONSTRAINT IF EXISTS "agent_runtime_execution_edges_parent_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runtime_execution_edges" ADD CONSTRAINT "agent_runtime_execution_edges_parent_operation_id_agent_operations_id_fk" FOREIGN KEY ("parent_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runtime_execution_edges" DROP CONSTRAINT IF EXISTS "agent_runtime_execution_edges_child_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runtime_execution_edges" ADD CONSTRAINT "agent_runtime_execution_edges_child_operation_id_agent_operations_id_fk" FOREIGN KEY ("child_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runtime_interventions" DROP CONSTRAINT IF EXISTS "agent_runtime_interventions_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runtime_interventions" ADD CONSTRAINT "agent_runtime_interventions_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runtime_journal" DROP CONSTRAINT IF EXISTS "agent_runtime_journal_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runtime_journal" ADD CONSTRAINT "agent_runtime_journal_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runtime_journal_counters" DROP CONSTRAINT IF EXISTS "agent_runtime_journal_counters_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runtime_journal_counters" ADD CONSTRAINT "agent_runtime_journal_counters_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_checkpoints_operation_id_idx" ON "agent_runtime_checkpoints" USING btree ("operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_checkpoints_op_sequence_idx" ON "agent_runtime_checkpoints" USING btree ("operation_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runtime_checkpoints_op_step_sequence_uidx" ON "agent_runtime_checkpoints" USING btree ("operation_id","step_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runtime_execution_edges_child_uidx" ON "agent_runtime_execution_edges" USING btree ("child_operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_execution_edges_parent_idx" ON "agent_runtime_execution_edges" USING btree ("parent_operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_execution_edges_call_id_idx" ON "agent_runtime_execution_edges" USING btree ("call_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runtime_interventions_op_intervention_uidx" ON "agent_runtime_interventions" USING btree ("operation_id","intervention_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_interventions_operation_id_idx" ON "agent_runtime_interventions" USING btree ("operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_interventions_status_idx" ON "agent_runtime_interventions" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runtime_journal_op_sequence_uidx" ON "agent_runtime_journal" USING btree ("operation_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runtime_journal_op_event_id_uidx" ON "agent_runtime_journal" USING btree ("operation_id","event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_journal_operation_id_idx" ON "agent_runtime_journal" USING btree ("operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runtime_journal_operation_id_sequence_idx" ON "agent_runtime_journal" USING btree ("operation_id","sequence");
