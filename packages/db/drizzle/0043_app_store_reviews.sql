CREATE TABLE "app_store_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"store" varchar(20) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"rating" smallint NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"reviewer_name" varchar(255),
	"country_code" varchar(2),
	"app_version" varchar(50),
	"language_code" varchar(10),
	"developer_response" text,
	"developer_response_at" timestamp with time zone,
	"created_at_in_store" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "apple_app_store_id" bigint;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "latest_rating" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "latest_rating_count" integer;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "current_version_rating" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "current_version_rating_count" integer;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "latest_rating_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_store_reviews" ADD CONSTRAINT "app_store_reviews_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_store_reviews" ADD CONSTRAINT "app_store_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_store_reviews" ADD CONSTRAINT "app_store_reviews_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_store_reviews_app_store_external_idx" ON "app_store_reviews" USING btree ("app_id","store","external_id");--> statement-breakpoint
CREATE INDEX "app_store_reviews_project_created_idx" ON "app_store_reviews" USING btree ("project_id","created_at_in_store") WHERE "app_store_reviews"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "app_store_reviews_app_created_idx" ON "app_store_reviews" USING btree ("app_id","created_at_in_store") WHERE "app_store_reviews"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "app_store_reviews_project_rating_idx" ON "app_store_reviews" USING btree ("project_id","rating");