ALTER TABLE "app_store_reviews" ADD COLUMN "developer_response_id" varchar(255);--> statement-breakpoint
ALTER TABLE "app_store_reviews" ADD COLUMN "developer_response_state" varchar(20);--> statement-breakpoint
ALTER TABLE "app_store_reviews" ADD COLUMN "responded_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app_store_reviews" ADD CONSTRAINT "app_store_reviews_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;