ALTER TABLE "events" ADD COLUMN "session_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX "events_app_session_timestamp_idx" ON "events" USING btree ("app_id","session_id","timestamp");