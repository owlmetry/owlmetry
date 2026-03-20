ALTER TABLE "events" RENAME COLUMN "is_debug" TO "is_dev";--> statement-breakpoint
ALTER TABLE "metric_events" RENAME COLUMN "is_debug" TO "is_dev";--> statement-breakpoint
ALTER TABLE "funnel_events" RENAME COLUMN "is_debug" TO "is_dev";--> statement-breakpoint
DROP INDEX IF EXISTS "events_app_debug_timestamp_idx";--> statement-breakpoint
CREATE INDEX "events_app_dev_timestamp_idx" ON "events" USING btree ("app_id","is_dev","timestamp");
