ALTER TABLE "app_users" ADD COLUMN "last_locale" varchar(20);--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "last_preferred_language" varchar(35);--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "supported_languages" text[];--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "supported_languages_source" varchar(10);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "preferred_language" varchar(35);