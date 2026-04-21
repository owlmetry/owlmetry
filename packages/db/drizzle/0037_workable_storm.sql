CREATE TYPE "public"."feedback_status" AS ENUM('new', 'in_review', 'addressed', 'dismissed');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"user_id" varchar(255),
	"message" text NOT NULL,
	"submitter_name" varchar(255),
	"submitter_email" varchar(320),
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"environment" "environment",
	"os_version" varchar(50),
	"app_version" varchar(50),
	"device_model" varchar(100),
	"country_code" varchar(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feedback_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" uuid NOT NULL,
	"author_type" varchar(10) NOT NULL,
	"author_id" uuid NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_project_status_idx" ON "feedback" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "feedback_project_created_at_idx" ON "feedback" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_app_status_idx" ON "feedback" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "feedback_session_id_idx" ON "feedback" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "feedback_user_id_idx" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "feedback_comments_feedback_created_at_idx" ON "feedback_comments" USING btree ("feedback_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_comments_author_id_idx" ON "feedback_comments" USING btree ("author_id");