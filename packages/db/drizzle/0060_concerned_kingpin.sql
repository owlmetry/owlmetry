ALTER TABLE "app_users" ADD COLUMN "is_dev" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "app_users_project_is_dev_idx" ON "app_users" USING btree ("project_id","is_dev");--> statement-breakpoint
-- Backfill is_dev from each user's most-recent CLIENT event (last-write-wins),
-- mirroring how upsertAppUsers resolves it going forward. Backend-platform apps
-- are excluded (dev/test clients hit prod backends, so backend events are always
-- "production" and would mislabel a dev tester). Users with no client events
-- (backend-only / pre-existing) keep the default false = production.
UPDATE "app_users" au SET "is_dev" = sub.is_dev
FROM (
  SELECT DISTINCT ON (e.user_id, a.project_id) a.project_id, e.user_id, e.is_dev
  FROM "events" e
  JOIN "apps" a ON a.id = e.app_id
  WHERE a.platform <> 'backend' AND e.user_id IS NOT NULL
  ORDER BY e.user_id, a.project_id, e.timestamp DESC
) sub
WHERE au.project_id = sub.project_id AND au.user_id = sub.user_id;