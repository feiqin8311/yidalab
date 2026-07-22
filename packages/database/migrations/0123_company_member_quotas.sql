CREATE TABLE IF NOT EXISTS "company_member_quotas" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"monthly_limit_cost" numeric(20, 6),
	"allowed_models" jsonb,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_member_quotas_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_member_quotas" ADD CONSTRAINT "company_member_quotas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_member_quotas" ADD CONSTRAINT "company_member_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_member_quotas" ADD CONSTRAINT "company_member_quotas_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_member_quotas_user_id_idx" ON "company_member_quotas" USING btree ("user_id");
