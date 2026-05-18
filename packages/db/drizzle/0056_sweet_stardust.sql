CREATE TYPE "public"."questionnaire_response_status" AS ENUM('new', 'in_review', 'addressed', 'dismissed');--> statement-breakpoint
CREATE TABLE "questionnaire_response_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"questionnaire_response_id" uuid NOT NULL,
	"author_type" varchar(10) NOT NULL,
	"author_id" uuid NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"questionnaire_id" uuid NOT NULL,
	"slug" varchar(64) NOT NULL,
	"app_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"user_id" varchar(255),
	"answers" jsonb NOT NULL,
	"schema_snapshot" jsonb NOT NULL,
	"status" "questionnaire_response_status" DEFAULT 'new' NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"environment" "environment",
	"os_version" varchar(50),
	"app_version" varchar(50),
	"sdk_name" varchar(50),
	"sdk_version" varchar(50),
	"device_model" varchar(100),
	"country_code" varchar(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questionnaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"slug" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"schema" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "questionnaire_response_comments" ADD CONSTRAINT "questionnaire_response_comments_questionnaire_response_id_questionnaire_responses_id_fk" FOREIGN KEY ("questionnaire_response_id") REFERENCES "public"."questionnaire_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_questionnaire_id_questionnaires_id_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "public"."questionnaires"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questionnaire_response_comments_response_created_at_idx" ON "questionnaire_response_comments" USING btree ("questionnaire_response_id","created_at");--> statement-breakpoint
CREATE INDEX "questionnaire_response_comments_author_id_idx" ON "questionnaire_response_comments" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_one_per_user_idx" ON "questionnaire_responses" USING btree ("project_id","slug","user_id") WHERE "questionnaire_responses"."deleted_at" IS NULL AND "questionnaire_responses"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "questionnaire_responses_project_status_idx" ON "questionnaire_responses" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_project_created_at_idx" ON "questionnaire_responses" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_questionnaire_created_at_idx" ON "questionnaire_responses" USING btree ("questionnaire_id","created_at");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_app_status_idx" ON "questionnaire_responses" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_session_id_idx" ON "questionnaire_responses" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_user_id_idx" ON "questionnaire_responses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaires_project_slug_active_idx" ON "questionnaires" USING btree ("project_id","slug") WHERE "questionnaires"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "questionnaires_project_idx" ON "questionnaires" USING btree ("project_id","deleted_at");