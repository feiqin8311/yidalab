CREATE TABLE IF NOT EXISTS "resource_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"grantee_type" text NOT NULL,
	"grantee_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_grants" ADD CONSTRAINT "resource_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_grants_unique" ON "resource_grants" USING btree ("workspace_id","resource_type","resource_id","grantee_type","grantee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_grants_resource_idx" ON "resource_grants" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_grants_grantee_idx" ON "resource_grants" USING btree ("workspace_id","grantee_type","grantee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_grants_workspace_idx" ON "resource_grants" USING btree ("workspace_id");
