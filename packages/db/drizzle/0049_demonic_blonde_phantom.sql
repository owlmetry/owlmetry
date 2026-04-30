ALTER TYPE "public"."issue_status" ADD VALUE 'snoozed';--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "snoozed_at" timestamp with time zone;