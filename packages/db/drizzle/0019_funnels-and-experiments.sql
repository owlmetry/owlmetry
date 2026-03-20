CREATE TABLE "funnel_events" (
	"id" uuid DEFAULT gen_random_uuid(),
	"app_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" varchar(255),
	"api_key_id" uuid,
	"step_name" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"screen_name" varchar(255),
	"custom_attributes" jsonb,
	"experiments" jsonb,
	"environment" "environment",
	"os_version" varchar(50),
	"app_version" varchar(50),
	"device_model" varchar(100),
	"build_number" varchar(50),
	"is_debug" boolean DEFAULT false NOT NULL,
	"client_event_id" uuid,
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funnel_progress" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "funnel_progress" CASCADE;--> statement-breakpoint
ALTER TABLE "funnel_definitions" DROP CONSTRAINT "funnel_definitions_app_id_apps_id_fk";
--> statement-breakpoint
DROP INDEX "funnel_definitions_app_id_idx";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "experiments" jsonb;--> statement-breakpoint
ALTER TABLE "funnel_definitions" ADD COLUMN "project_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "funnel_definitions" ADD COLUMN "slug" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "funnel_definitions" ADD COLUMN "description" text;--> statement-breakpoint
CREATE INDEX "funnel_events_app_step_timestamp_idx" ON "funnel_events" USING btree ("app_id","step_name","timestamp");--> statement-breakpoint
CREATE INDEX "funnel_events_app_user_timestamp_idx" ON "funnel_events" USING btree ("app_id","user_id","timestamp");--> statement-breakpoint
CREATE INDEX "funnel_events_app_step_user_timestamp_idx" ON "funnel_events" USING btree ("app_id","step_name","user_id","timestamp");--> statement-breakpoint
CREATE INDEX "funnel_events_app_client_event_id_idx" ON "funnel_events" USING btree ("app_id","client_event_id");--> statement-breakpoint
ALTER TABLE "funnel_definitions" ADD CONSTRAINT "funnel_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funnel_definitions_project_id_idx" ON "funnel_definitions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_definitions_project_slug_idx" ON "funnel_definitions" USING btree ("project_id","slug");--> statement-breakpoint
ALTER TABLE "funnel_definitions" DROP COLUMN "app_id";