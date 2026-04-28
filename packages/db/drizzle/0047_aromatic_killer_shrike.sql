DELETE FROM "app_store_reviews" WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
DROP INDEX "app_store_reviews_project_created_idx";--> statement-breakpoint
DROP INDEX "app_store_reviews_app_created_idx";--> statement-breakpoint
CREATE INDEX "app_store_reviews_project_created_idx" ON "app_store_reviews" USING btree ("project_id","created_at_in_store");--> statement-breakpoint
CREATE INDEX "app_store_reviews_app_created_idx" ON "app_store_reviews" USING btree ("app_id","created_at_in_store");--> statement-breakpoint
ALTER TABLE "app_store_reviews" DROP COLUMN "deleted_at";