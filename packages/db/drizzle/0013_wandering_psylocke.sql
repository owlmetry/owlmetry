CREATE TYPE "public"."metric_phase" AS ENUM('start', 'complete', 'fail', 'cancel', 'record');--> statement-breakpoint
CREATE TYPE "public"."metric_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"documentation" text,
	"schema_definition" jsonb,
	"aggregation_rules" jsonb,
	"status" "metric_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metric_events" (
	"id" uuid DEFAULT gen_random_uuid(),
	"app_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" varchar(255),
	"metric_slug" varchar(255) NOT NULL,
	"phase" "metric_phase" NOT NULL,
	"tracking_id" uuid,
	"duration_ms" integer,
	"error" text,
	"attributes" jsonb,
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
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_definitions_project_id_idx" ON "metric_definitions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_definitions_project_slug_idx" ON "metric_definitions" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "metric_events_app_slug_timestamp_idx" ON "metric_events" USING btree ("app_id","metric_slug","timestamp");--> statement-breakpoint
CREATE INDEX "metric_events_app_slug_phase_timestamp_idx" ON "metric_events" USING btree ("app_id","metric_slug","phase","timestamp");--> statement-breakpoint
CREATE INDEX "metric_events_app_tracking_id_idx" ON "metric_events" USING btree ("app_id","tracking_id");--> statement-breakpoint
CREATE INDEX "metric_events_app_client_event_id_idx" ON "metric_events" USING btree ("app_id","client_event_id");--> statement-breakpoint
ALTER TABLE "public"."events" ALTER COLUMN "level" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."log_level";--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'debug', 'warn', 'error', 'attention');--> statement-breakpoint
ALTER TABLE "public"."events" ALTER COLUMN "level" SET DATA TYPE "public"."log_level" USING "level"::"public"."log_level";