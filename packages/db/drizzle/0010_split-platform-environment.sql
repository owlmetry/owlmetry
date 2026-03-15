CREATE TYPE "public"."app_platform" AS ENUM('apple', 'android', 'web', 'backend');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('ios', 'ipados', 'macos', 'android', 'web', 'backend');--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "platform" TO "environment";--> statement-breakpoint
UPDATE "events" SET "environment" = 'backend' WHERE "environment" = 'server';--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "environment" SET DATA TYPE environment USING "environment"::environment;--> statement-breakpoint
UPDATE "apps" SET "platform" = 'apple' WHERE "platform" IN ('ios', 'ipados', 'macos');--> statement-breakpoint
UPDATE "apps" SET "platform" = 'backend' WHERE "platform" = 'server';--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "platform" SET DATA TYPE app_platform USING "platform"::app_platform;