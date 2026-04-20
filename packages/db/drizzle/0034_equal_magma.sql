ALTER TABLE "projects" ADD COLUMN "attachment_user_quota_bytes" bigint;--> statement-breakpoint
CREATE INDEX "event_attachments_project_user_idx" ON "event_attachments" USING btree ("project_id","user_id");--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "attachment_max_file_bytes";