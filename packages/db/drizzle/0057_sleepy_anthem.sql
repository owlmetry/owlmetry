ALTER TYPE "public"."questionnaire_response_status" ADD VALUE 'draft' BEFORE 'new';--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ALTER COLUMN "schema_snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "questionnaire_responses" SET "submitted_at" = "created_at" WHERE "submitted_at" IS NULL;