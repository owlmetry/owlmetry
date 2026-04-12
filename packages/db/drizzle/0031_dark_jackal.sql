CREATE TYPE "public"."issue_alert_frequency" AS ENUM('none', 'hourly', '6_hourly', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('new', 'in_progress', 'resolved', 'silenced', 'regressed');--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"author_type" varchar(10) NOT NULL,
	"author_id" uuid NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issue_fingerprints" (
	"fingerprint" varchar(64) NOT NULL,
	"app_id" uuid NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"issue_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" varchar(255),
	"app_version" varchar(50),
	"environment" "environment",
	"event_id" uuid,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "issue_status" DEFAULT 'new' NOT NULL,
	"title" text NOT NULL,
	"source_module" text,
	"is_dev" boolean DEFAULT false NOT NULL,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"unique_user_count" integer DEFAULT 0 NOT NULL,
	"resolved_at_version" varchar(50),
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "issue_alert_frequency" "issue_alert_frequency" DEFAULT 'daily';--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_fingerprints" ADD CONSTRAINT "issue_fingerprints_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_fingerprints" ADD CONSTRAINT "issue_fingerprints_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_occurrences" ADD CONSTRAINT "issue_occurrences_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_comments_issue_created_at_idx" ON "issue_comments" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_comments_author_id_idx" ON "issue_comments" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_fingerprints_pk" ON "issue_fingerprints" USING btree ("fingerprint","app_id","is_dev");--> statement-breakpoint
CREATE INDEX "issue_fingerprints_issue_id_idx" ON "issue_fingerprints" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_occurrences_issue_session_idx" ON "issue_occurrences" USING btree ("issue_id","session_id");--> statement-breakpoint
CREATE INDEX "issue_occurrences_issue_timestamp_idx" ON "issue_occurrences" USING btree ("issue_id","timestamp");--> statement-breakpoint
CREATE INDEX "issue_occurrences_user_id_idx" ON "issue_occurrences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "issues_project_status_idx" ON "issues" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "issues_project_last_seen_idx" ON "issues" USING btree ("project_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "issues_project_unique_users_idx" ON "issues" USING btree ("project_id","unique_user_count");--> statement-breakpoint
CREATE INDEX "issues_app_status_idx" ON "issues" USING btree ("app_id","status");