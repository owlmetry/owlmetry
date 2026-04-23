ALTER TABLE "apps" ADD COLUMN "latest_app_version" varchar(50);--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "latest_app_version_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "latest_app_version_source" varchar(20);--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "first_seen_app_version" varchar(50);--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "last_seen_app_version" varchar(50);--> statement-breakpoint
-- Backfill last/first_seen_app_version from existing issue_occurrences
UPDATE "issues" i SET
  "last_seen_app_version" = (
    SELECT o."app_version" FROM "issue_occurrences" o
    WHERE o."issue_id" = i."id" AND o."app_version" IS NOT NULL
    ORDER BY o."timestamp" DESC LIMIT 1
  ),
  "first_seen_app_version" = (
    SELECT o."app_version" FROM "issue_occurrences" o
    WHERE o."issue_id" = i."id" AND o."app_version" IS NOT NULL
    ORDER BY o."timestamp" ASC LIMIT 1
  );