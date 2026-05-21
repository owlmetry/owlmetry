CREATE TABLE "events_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"day" date NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"unique_sessions" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"unique_sessions" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_events_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"day" date NOT NULL,
	"step_name" varchar(255) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_events_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"step_name" varchar(255) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_events_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"day" date NOT NULL,
	"metric_slug" varchar(255) NOT NULL,
	"phase" "metric_phase" NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"sum_duration_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_events_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"metric_slug" varchar(255) NOT NULL,
	"phase" "metric_phase" NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"sum_duration_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"questionnaire_id" uuid NOT NULL,
	"is_dev" boolean NOT NULL,
	"day" date NOT NULL,
	"submitted_count" integer DEFAULT 0 NOT NULL,
	"draft_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"questionnaire_id" uuid NOT NULL,
	"is_dev" boolean NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"submitted_count" integer DEFAULT 0 NOT NULL,
	"draft_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events_daily" ADD CONSTRAINT "events_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_daily" ADD CONSTRAINT "events_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_daily" ADD CONSTRAINT "events_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_hourly" ADD CONSTRAINT "events_hourly_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_hourly" ADD CONSTRAINT "events_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_hourly" ADD CONSTRAINT "events_hourly_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_daily" ADD CONSTRAINT "funnel_events_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_daily" ADD CONSTRAINT "funnel_events_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_daily" ADD CONSTRAINT "funnel_events_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_hourly" ADD CONSTRAINT "funnel_events_hourly_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_hourly" ADD CONSTRAINT "funnel_events_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_hourly" ADD CONSTRAINT "funnel_events_hourly_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_daily" ADD CONSTRAINT "metric_events_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_daily" ADD CONSTRAINT "metric_events_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_daily" ADD CONSTRAINT "metric_events_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_hourly" ADD CONSTRAINT "metric_events_hourly_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_hourly" ADD CONSTRAINT "metric_events_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_hourly" ADD CONSTRAINT "metric_events_hourly_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_daily" ADD CONSTRAINT "questionnaire_responses_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_daily" ADD CONSTRAINT "questionnaire_responses_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_daily" ADD CONSTRAINT "questionnaire_responses_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_hourly" ADD CONSTRAINT "questionnaire_responses_hourly_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_hourly" ADD CONSTRAINT "questionnaire_responses_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_hourly" ADD CONSTRAINT "questionnaire_responses_hourly_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_daily_project_dev_day_rollup_idx" ON "events_daily" USING btree ("project_id","is_dev","day") WHERE "events_daily"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_daily_project_app_dev_day_idx" ON "events_daily" USING btree ("project_id","app_id","is_dev","day") WHERE "events_daily"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_daily_team_day_idx" ON "events_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "events_daily_project_day_idx" ON "events_daily" USING btree ("project_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "events_hourly_project_dev_hour_rollup_idx" ON "events_hourly" USING btree ("project_id","is_dev","hour") WHERE "events_hourly"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_hourly_project_app_dev_hour_idx" ON "events_hourly" USING btree ("project_id","app_id","is_dev","hour") WHERE "events_hourly"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_hourly_team_hour_idx" ON "events_hourly" USING btree ("team_id","hour");--> statement-breakpoint
CREATE INDEX "events_hourly_project_hour_idx" ON "events_hourly" USING btree ("project_id","hour");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_daily_project_dev_day_step_rollup_idx" ON "funnel_events_daily" USING btree ("project_id","is_dev","day","step_name") WHERE "funnel_events_daily"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_daily_project_app_dev_day_step_idx" ON "funnel_events_daily" USING btree ("project_id","app_id","is_dev","day","step_name") WHERE "funnel_events_daily"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "funnel_events_daily_team_day_idx" ON "funnel_events_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "funnel_events_daily_project_step_day_idx" ON "funnel_events_daily" USING btree ("project_id","step_name","day");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_hourly_project_dev_hour_step_rollup_idx" ON "funnel_events_hourly" USING btree ("project_id","is_dev","hour","step_name") WHERE "funnel_events_hourly"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_hourly_project_app_dev_hour_step_idx" ON "funnel_events_hourly" USING btree ("project_id","app_id","is_dev","hour","step_name") WHERE "funnel_events_hourly"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "funnel_events_hourly_team_hour_idx" ON "funnel_events_hourly" USING btree ("team_id","hour");--> statement-breakpoint
CREATE INDEX "funnel_events_hourly_project_step_hour_idx" ON "funnel_events_hourly" USING btree ("project_id","step_name","hour");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_events_daily_project_dev_day_slug_phase_rollup_idx" ON "metric_events_daily" USING btree ("project_id","is_dev","day","metric_slug","phase") WHERE "metric_events_daily"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_events_daily_project_app_dev_day_slug_phase_idx" ON "metric_events_daily" USING btree ("project_id","app_id","is_dev","day","metric_slug","phase") WHERE "metric_events_daily"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "metric_events_daily_team_day_idx" ON "metric_events_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "metric_events_daily_project_slug_day_idx" ON "metric_events_daily" USING btree ("project_id","metric_slug","day");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_events_hourly_project_dev_hour_slug_phase_rollup_idx" ON "metric_events_hourly" USING btree ("project_id","is_dev","hour","metric_slug","phase") WHERE "metric_events_hourly"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_events_hourly_project_app_dev_hour_slug_phase_idx" ON "metric_events_hourly" USING btree ("project_id","app_id","is_dev","hour","metric_slug","phase") WHERE "metric_events_hourly"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "metric_events_hourly_team_hour_idx" ON "metric_events_hourly" USING btree ("team_id","hour");--> statement-breakpoint
CREATE INDEX "metric_events_hourly_project_slug_hour_idx" ON "metric_events_hourly" USING btree ("project_id","metric_slug","hour");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_daily_project_dev_day_q_rollup_idx" ON "questionnaire_responses_daily" USING btree ("project_id","is_dev","day","questionnaire_id") WHERE "questionnaire_responses_daily"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_daily_project_app_dev_day_q_idx" ON "questionnaire_responses_daily" USING btree ("project_id","app_id","is_dev","day","questionnaire_id") WHERE "questionnaire_responses_daily"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "questionnaire_responses_daily_team_day_idx" ON "questionnaire_responses_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_daily_project_q_day_idx" ON "questionnaire_responses_daily" USING btree ("project_id","questionnaire_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_hourly_project_dev_hour_q_rollup_idx" ON "questionnaire_responses_hourly" USING btree ("project_id","is_dev","hour","questionnaire_id") WHERE "questionnaire_responses_hourly"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_hourly_project_app_dev_hour_q_idx" ON "questionnaire_responses_hourly" USING btree ("project_id","app_id","is_dev","hour","questionnaire_id") WHERE "questionnaire_responses_hourly"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "questionnaire_responses_hourly_team_hour_idx" ON "questionnaire_responses_hourly" USING btree ("team_id","hour");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_hourly_project_q_hour_idx" ON "questionnaire_responses_hourly" USING btree ("project_id","questionnaire_id","hour");