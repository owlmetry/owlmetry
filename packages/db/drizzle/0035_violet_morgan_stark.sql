ALTER TABLE "app_users" ADD COLUMN "last_country_code" varchar(2);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "country_code" varchar(2);--> statement-breakpoint
ALTER TABLE "funnel_events" ADD COLUMN "country_code" varchar(2);--> statement-breakpoint
ALTER TABLE "metric_events" ADD COLUMN "country_code" varchar(2);