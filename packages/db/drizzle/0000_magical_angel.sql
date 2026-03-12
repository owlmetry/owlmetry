CREATE TYPE "public"."api_key_type" AS ENUM('client', 'agent');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'debug', 'warn', 'error', 'attention', 'tracking');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"key_type" "api_key_type" NOT NULL,
	"app_id" uuid,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"permissions" jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"platform" varchar(50) NOT NULL,
	"bundle_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid DEFAULT gen_random_uuid(),
	"app_id" uuid NOT NULL,
	"client_event_id" varchar(255),
	"user_identifier" varchar(255),
	"level" "log_level" NOT NULL,
	"source" text,
	"body" text NOT NULL,
	"context" varchar(255),
	"meta" jsonb,
	"platform" varchar(20),
	"os_version" varchar(50),
	"app_version" varchar(50),
	"device_model" varchar(100),
	"build_number" varchar(50),
	"locale" varchar(20),
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"solved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"user_identifier" varchar(255) NOT NULL,
	"step_completed" text NOT NULL,
	"step_event_id" uuid,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_definitions" ADD CONSTRAINT "funnel_definitions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_progress" ADD CONSTRAINT "funnel_progress_funnel_id_funnel_definitions_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnel_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "api_keys_team_id_idx" ON "api_keys" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "apps_team_id_idx" ON "apps" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "events_app_timestamp_idx" ON "events" USING btree ("app_id","timestamp");--> statement-breakpoint
CREATE INDEX "events_app_level_timestamp_idx" ON "events" USING btree ("app_id","level","timestamp");--> statement-breakpoint
CREATE INDEX "events_app_user_timestamp_idx" ON "events" USING btree ("app_id","user_identifier","timestamp");--> statement-breakpoint
CREATE INDEX "events_app_context_timestamp_idx" ON "events" USING btree ("app_id","context","timestamp");--> statement-breakpoint
CREATE INDEX "events_client_event_id_idx" ON "events" USING btree ("app_id","client_event_id");--> statement-breakpoint
CREATE INDEX "funnel_definitions_app_id_idx" ON "funnel_definitions" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "funnel_progress_funnel_user_idx" ON "funnel_progress" USING btree ("funnel_id","user_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_idx" ON "team_members" USING btree ("team_id","user_id");