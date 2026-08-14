-- Workspace-scoped AI configuration is shared by every member. Older versions
-- included user_id in the workspace conflict key even though reads use only
-- workspace_id, which allowed stale duplicate credentials and model settings.
-- Keep the most recently updated row before tightening the unique indexes.
DELETE FROM "ai_models" AS duplicate
USING "ai_models" AS canonical
WHERE duplicate."workspace_id" IS NOT NULL
  AND duplicate."id" = canonical."id"
  AND duplicate."provider_id" = canonical."provider_id"
  AND duplicate."workspace_id" = canonical."workspace_id"
  AND (
    duplicate."updated_at" < canonical."updated_at"
    OR (duplicate."updated_at" = canonical."updated_at" AND duplicate."_id" < canonical."_id")
  );--> statement-breakpoint
DELETE FROM "ai_providers" AS duplicate
USING "ai_providers" AS canonical
WHERE duplicate."workspace_id" IS NOT NULL
  AND duplicate."id" = canonical."id"
  AND duplicate."workspace_id" = canonical."workspace_id"
  AND (
    duplicate."updated_at" < canonical."updated_at"
    OR (duplicate."updated_at" = canonical."updated_at" AND duplicate."_id" < canonical."_id")
  );--> statement-breakpoint
DROP INDEX IF EXISTS "ai_models_id_provider_id_user_id_workspace_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "ai_providers_id_user_id_workspace_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_id_provider_id_workspace_id_unique" ON "ai_models" USING btree ("id","provider_id","workspace_id") WHERE "ai_models"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_id_workspace_id_unique" ON "ai_providers" USING btree ("id","workspace_id") WHERE "ai_providers"."workspace_id" IS NOT NULL;
