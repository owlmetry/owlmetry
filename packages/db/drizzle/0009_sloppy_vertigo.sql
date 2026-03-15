ALTER TYPE "public"."api_key_type" ADD VALUE 'server';--> statement-breakpoint
ALTER TABLE "apps" ALTER COLUMN "bundle_id" DROP NOT NULL;