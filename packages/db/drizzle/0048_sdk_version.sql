ALTER TABLE "app_users" ADD COLUMN "last_sdk_name" varchar(50);--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "last_sdk_version" varchar(50);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sdk_name" varchar(50);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sdk_version" varchar(50);--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "sdk_name" varchar(50);--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "sdk_version" varchar(50);--> statement-breakpoint
ALTER TABLE "funnel_events" ADD COLUMN "sdk_name" varchar(50);--> statement-breakpoint
ALTER TABLE "funnel_events" ADD COLUMN "sdk_version" varchar(50);--> statement-breakpoint
ALTER TABLE "issue_occurrences" ADD COLUMN "sdk_name" varchar(50);--> statement-breakpoint
ALTER TABLE "issue_occurrences" ADD COLUMN "sdk_version" varchar(50);--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "first_seen_sdk_version" varchar(50);--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "last_seen_sdk_version" varchar(50);--> statement-breakpoint
ALTER TABLE "metric_events" ADD COLUMN "sdk_name" varchar(50);--> statement-breakpoint
ALTER TABLE "metric_events" ADD COLUMN "sdk_version" varchar(50);