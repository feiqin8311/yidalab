-- Private conversation visibility (topics/messages/threads/message_groups)
-- + personal memory scope (global | agent) for dual-layer memory.
-- Privacy-first: new columns default private / global so existing 1:1 rows
-- become owner-only once ownership filters start using visibility.

ALTER TABLE "message_groups" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint

ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'global' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint

ALTER TABLE "user_memories" DROP CONSTRAINT IF EXISTS "user_memories_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_activities" DROP CONSTRAINT IF EXISTS "user_memories_activities_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD CONSTRAINT "user_memories_activities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" DROP CONSTRAINT IF EXISTS "user_memories_contexts_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD CONSTRAINT "user_memories_contexts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_experiences" DROP CONSTRAINT IF EXISTS "user_memories_experiences_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD CONSTRAINT "user_memories_experiences_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_identities" DROP CONSTRAINT IF EXISTS "user_memories_identities_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD CONSTRAINT "user_memories_identities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" DROP CONSTRAINT IF EXISTS "user_memories_preferences_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD CONSTRAINT "user_memories_preferences_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "message_groups_workspace_visibility_idx" ON "message_groups" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_workspace_visibility_idx" ON "messages" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_workspace_visibility_idx" ON "threads" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_workspace_visibility_idx" ON "topics" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_user_scope_agent_idx" ON "user_memories" USING btree ("user_id","scope","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_activities_user_scope_agent_idx" ON "user_memories_activities" USING btree ("user_id","scope","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_contexts_user_scope_agent_idx" ON "user_memories_contexts" USING btree ("user_id","scope","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_experiences_user_scope_agent_idx" ON "user_memories_experiences" USING btree ("user_id","scope","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_identities_user_scope_agent_idx" ON "user_memories_identities" USING btree ("user_id","scope","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_preferences_user_scope_agent_idx" ON "user_memories_preferences" USING btree ("user_id","scope","agent_id");--> statement-breakpoint

-- Scope integrity:
-- - global rows must not carry agent_id
-- - agent rows may keep agent_id; when the agent is deleted (ON DELETE SET NULL)
--   they remain scope='agent' with agent_id NULL = "deleted-agent memory",
--   not promoted to global (by design). Dual-layer retrieval requires a
--   matching agent_id, so orphans are unreadable at runtime until management
--   export/cleanup.
DO $$
BEGIN
  UPDATE "user_memories" SET agent_id = NULL WHERE scope = 'global' AND agent_id IS NOT NULL;
  UPDATE "user_memories_activities" SET agent_id = NULL WHERE scope = 'global' AND agent_id IS NOT NULL;
  UPDATE "user_memories_contexts" SET agent_id = NULL WHERE scope = 'global' AND agent_id IS NOT NULL;
  UPDATE "user_memories_experiences" SET agent_id = NULL WHERE scope = 'global' AND agent_id IS NOT NULL;
  UPDATE "user_memories_identities" SET agent_id = NULL WHERE scope = 'global' AND agent_id IS NOT NULL;
  UPDATE "user_memories_preferences" SET agent_id = NULL WHERE scope = 'global' AND agent_id IS NOT NULL;
END $$;--> statement-breakpoint

ALTER TABLE "user_memories" DROP CONSTRAINT IF EXISTS "user_memories_scope_agent_chk";--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_scope_agent_chk" CHECK (
  (scope = 'global' AND agent_id IS NULL) OR (scope = 'agent')
);--> statement-breakpoint
ALTER TABLE "user_memories_activities" DROP CONSTRAINT IF EXISTS "user_memories_activities_scope_agent_chk";--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD CONSTRAINT "user_memories_activities_scope_agent_chk" CHECK (
  (scope = 'global' AND agent_id IS NULL) OR (scope = 'agent')
);--> statement-breakpoint
ALTER TABLE "user_memories_contexts" DROP CONSTRAINT IF EXISTS "user_memories_contexts_scope_agent_chk";--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD CONSTRAINT "user_memories_contexts_scope_agent_chk" CHECK (
  (scope = 'global' AND agent_id IS NULL) OR (scope = 'agent')
);--> statement-breakpoint
ALTER TABLE "user_memories_experiences" DROP CONSTRAINT IF EXISTS "user_memories_experiences_scope_agent_chk";--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD CONSTRAINT "user_memories_experiences_scope_agent_chk" CHECK (
  (scope = 'global' AND agent_id IS NULL) OR (scope = 'agent')
);--> statement-breakpoint
ALTER TABLE "user_memories_identities" DROP CONSTRAINT IF EXISTS "user_memories_identities_scope_agent_chk";--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD CONSTRAINT "user_memories_identities_scope_agent_chk" CHECK (
  (scope = 'global' AND agent_id IS NULL) OR (scope = 'agent')
);--> statement-breakpoint
ALTER TABLE "user_memories_preferences" DROP CONSTRAINT IF EXISTS "user_memories_preferences_scope_agent_chk";--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD CONSTRAINT "user_memories_preferences_scope_agent_chk" CHECK (
  (scope = 'global' AND agent_id IS NULL) OR (scope = 'agent')
);
