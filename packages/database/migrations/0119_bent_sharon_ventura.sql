CREATE TABLE "company_market_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content" text NOT NULL,
	"resources" jsonb DEFAULT '{}'::jsonb,
	"zip_file_hash" varchar(64),
	"publisher_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD COLUMN "department_id" text;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD COLUMN "position" varchar(128);--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "department_id" text;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "position" varchar(128);--> statement-breakpoint
ALTER TABLE "company_market_skills" ADD CONSTRAINT "company_market_skills_zip_file_hash_global_files_hash_id_fk" FOREIGN KEY ("zip_file_hash") REFERENCES "public"."global_files"("hash_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_market_skills" ADD CONSTRAINT "company_market_skills_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_market_skills" ADD CONSTRAINT "company_market_skills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_market_skills_workspace_identifier_unique" ON "company_market_skills" USING btree ("workspace_id","identifier");--> statement-breakpoint
CREATE INDEX "company_market_skills_workspace_updated_idx" ON "company_market_skills" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "company_market_skills_zip_hash_idx" ON "company_market_skills" USING btree ("zip_file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_workspace_id_name_unique" ON "departments" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "departments_workspace_id_idx" ON "departments" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_active_user_id_unique" ON "workspace_members" USING btree ("user_id") WHERE "workspace_members"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "full_name";
