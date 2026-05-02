ALTER TABLE "app_users" ADD COLUMN "total_revenue_usd_cents" bigint;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "revenue_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "app_users_project_revenue_idx" ON "app_users" USING btree ("project_id","total_revenue_usd_cents") WHERE "app_users"."total_revenue_usd_cents" IS NOT NULL;