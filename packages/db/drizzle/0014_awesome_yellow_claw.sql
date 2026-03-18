ALTER TABLE "public"."events" ALTER COLUMN "level" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."log_level";--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'debug', 'warn', 'error');--> statement-breakpoint
ALTER TABLE "public"."events" ALTER COLUMN "level" SET DATA TYPE "public"."log_level" USING "level"::"public"."log_level";