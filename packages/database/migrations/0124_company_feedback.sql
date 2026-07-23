CREATE TABLE IF NOT EXISTS "company_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_updated_at" timestamp with time zone,
	"status_updated_by" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_feedback" DROP CONSTRAINT IF EXISTS "company_feedback_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "company_feedback" ADD CONSTRAINT "company_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_feedback" DROP CONSTRAINT IF EXISTS "company_feedback_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "company_feedback" ADD CONSTRAINT "company_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_feedback" DROP CONSTRAINT IF EXISTS "company_feedback_status_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "company_feedback" ADD CONSTRAINT "company_feedback_status_updated_by_users_id_fk" FOREIGN KEY ("status_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_feedback_workspace_created_idx" ON "company_feedback" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_feedback_workspace_status_idx" ON "company_feedback" USING btree ("workspace_id","status");
