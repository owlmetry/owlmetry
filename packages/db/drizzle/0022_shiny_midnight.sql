UPDATE "metric_definitions" SET "deleted_at" = NOW() WHERE "status" = 'paused' AND "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "metric_definitions" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."metric_status";