CREATE TABLE "app_store_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"store" varchar(20) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"average_rating" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"current_version_average_rating" numeric(3, 2),
	"current_version_rating_count" integer,
	"app_version" varchar(50),
	"snapshot_date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "worldwide_average_rating" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "worldwide_rating_count" integer;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "worldwide_current_version_rating" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "worldwide_current_version_rating_count" integer;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "ratings_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_store_ratings" ADD CONSTRAINT "app_store_ratings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_store_ratings" ADD CONSTRAINT "app_store_ratings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_store_ratings" ADD CONSTRAINT "app_store_ratings_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_store_ratings_app_store_country_date_idx" ON "app_store_ratings" USING btree ("app_id","store","country_code","snapshot_date");--> statement-breakpoint
CREATE INDEX "app_store_ratings_project_date_idx" ON "app_store_ratings" USING btree ("project_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "app_store_ratings_team_date_idx" ON "app_store_ratings" USING btree ("team_id","snapshot_date");--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "latest_rating";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "latest_rating_count";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "current_version_rating";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "current_version_rating_count";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "latest_rating_updated_at";