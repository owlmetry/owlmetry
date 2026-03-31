-- Migration: Project-scoped users
-- Users are now unique per project (not per app).
-- A junction table (app_user_apps) tracks which apps a user has been seen from.

-- Step 1: Add nullable project_id column
ALTER TABLE "app_users" ADD COLUMN "project_id" uuid;--> statement-breakpoint

-- Step 2: Backfill project_id from the apps table
UPDATE "app_users" au SET "project_id" = a."project_id" FROM "apps" a WHERE au."app_id" = a."id";--> statement-breakpoint

-- Step 3: Delete orphaned app_users whose app no longer exists
DELETE FROM "app_users" WHERE "project_id" IS NULL;--> statement-breakpoint

-- Step 4: Create junction table
CREATE TABLE "app_user_apps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "app_user_id" uuid NOT NULL,
  "app_id" uuid NOT NULL,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_apps_user_app_idx" ON "app_user_apps" ("app_user_id", "app_id");--> statement-breakpoint
CREATE INDEX "app_user_apps_app_id_idx" ON "app_user_apps" ("app_id");--> statement-breakpoint

-- Step 5: Populate junction from current data
INSERT INTO "app_user_apps" ("app_user_id", "app_id", "first_seen_at", "last_seen_at")
SELECT "id", "app_id", "first_seen_at", "last_seen_at" FROM "app_users";--> statement-breakpoint

-- Step 6: Identify the keeper per duplicate group (earliest first_seen_at)
CREATE TEMP TABLE _dup_keepers AS
SELECT DISTINCT ON (project_id, user_id) id AS keeper_id, project_id, user_id
FROM "app_users"
WHERE project_id IS NOT NULL
AND (project_id, user_id) IN (
  SELECT project_id, user_id FROM "app_users" WHERE project_id IS NOT NULL
  GROUP BY project_id, user_id HAVING COUNT(*) > 1
)
ORDER BY project_id, user_id, first_seen_at ASC;--> statement-breakpoint

-- Step 7: Reassign junction entries from duplicates to keepers
-- First delete junction entries that would conflict (keeper already has that app)
DELETE FROM "app_user_apps" j
USING _dup_keepers k, "app_users" au
WHERE j.app_user_id = au.id
  AND au.project_id = k.project_id AND au.user_id = k.user_id
  AND au.id != k.keeper_id
  AND j.app_id IN (
    SELECT j2.app_id FROM "app_user_apps" j2 WHERE j2.app_user_id = k.keeper_id
  );--> statement-breakpoint

-- Now reassign remaining junction entries to keeper
UPDATE "app_user_apps" j
SET app_user_id = k.keeper_id
FROM _dup_keepers k, "app_users" au
WHERE j.app_user_id = au.id
  AND au.project_id = k.project_id AND au.user_id = k.user_id
  AND au.id != k.keeper_id;--> statement-breakpoint

-- Step 8: Update keepers with merged timestamps
UPDATE "app_users" au SET
  first_seen_at = agg.min_first,
  last_seen_at = agg.max_last
FROM (
  SELECT k.keeper_id, MIN(a.first_seen_at) AS min_first, MAX(a.last_seen_at) AS max_last
  FROM _dup_keepers k
  JOIN "app_users" a ON a.project_id = k.project_id AND a.user_id = k.user_id
  GROUP BY k.keeper_id
) agg
WHERE au.id = agg.keeper_id;--> statement-breakpoint

-- Step 9: Delete non-keeper duplicate rows
DELETE FROM "app_users" au
USING _dup_keepers k
WHERE au.project_id = k.project_id AND au.user_id = k.user_id AND au.id != k.keeper_id;--> statement-breakpoint

DROP TABLE IF EXISTS _dup_keepers;--> statement-breakpoint

-- Step 10: Make project_id NOT NULL and add FK
ALTER TABLE "app_users" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint

-- Step 11: Add junction table FKs
ALTER TABLE "app_user_apps" ADD CONSTRAINT "app_user_apps_app_user_id_app_users_id_fk"
  FOREIGN KEY ("app_user_id") REFERENCES "app_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_user_apps" ADD CONSTRAINT "app_user_apps_app_id_apps_id_fk"
  FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE;--> statement-breakpoint

-- Step 12: Drop old indexes and constraints, create new ones
DROP INDEX IF EXISTS "app_users_app_user_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "app_users_app_anonymous_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "app_users_app_last_seen_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_project_user_idx" ON "app_users" ("project_id", "user_id");--> statement-breakpoint
CREATE INDEX "app_users_project_anonymous_idx" ON "app_users" ("project_id", "is_anonymous");--> statement-breakpoint
CREATE INDEX "app_users_project_last_seen_idx" ON "app_users" ("project_id", "last_seen_at");--> statement-breakpoint

-- Step 13: Drop old app_id column and its FK
ALTER TABLE "app_users" DROP COLUMN "app_id";
