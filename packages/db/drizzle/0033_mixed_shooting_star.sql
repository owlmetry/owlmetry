CREATE TABLE "event_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"event_client_id" uuid,
	"event_id" uuid,
	"issue_id" uuid,
	"user_id" varchar(255),
	"original_filename" varchar(512) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_path" text NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "attachment_max_file_bytes" bigint;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "attachment_project_quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_attachments_project_created_at_idx" ON "event_attachments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "event_attachments_app_event_client_id_idx" ON "event_attachments" USING btree ("app_id","event_client_id");--> statement-breakpoint
CREATE INDEX "event_attachments_event_id_idx" ON "event_attachments" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_attachments_issue_id_idx" ON "event_attachments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "event_attachments_project_deleted_at_idx" ON "event_attachments" USING btree ("project_id","deleted_at");