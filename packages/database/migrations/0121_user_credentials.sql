CREATE TABLE IF NOT EXISTS "user_credentials" (
	"id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"values_encrypted" text,
	"masked_preview" varchar(64),
	"last_used_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_personal_key_uidx" ON "user_credentials" USING btree ("user_id","key") WHERE "workspace_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_workspace_key_uidx" ON "user_credentials" USING btree ("workspace_id","key") WHERE "workspace_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_credentials_user_id_idx" ON "user_credentials" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_credentials_workspace_id_idx" ON "user_credentials" USING btree ("workspace_id");
