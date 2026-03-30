CREATE TABLE "event_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"table_name" varchar(50) NOT NULL,
	"reason" varchar(50) NOT NULL,
	"cutoff_date" timestamp with time zone NOT NULL,
	"deleted_count" integer NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "retention_days_events" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "retention_days_metrics" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "retention_days_funnels" integer;--> statement-breakpoint
ALTER TABLE "event_deletions" ADD CONSTRAINT "event_deletions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_deletions_project_executed_at_idx" ON "event_deletions" USING btree ("project_id","executed_at");