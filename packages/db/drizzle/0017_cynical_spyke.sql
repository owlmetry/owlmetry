CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'api_key', 'system');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"action" "audit_action" NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"changes" jsonb,
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "metric_events" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_team_timestamp_idx" ON "audit_logs" USING btree ("team_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_type","actor_id");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;