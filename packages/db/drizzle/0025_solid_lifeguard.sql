-- Step 1: Add secret as nullable first
ALTER TABLE "api_keys" ADD COLUMN "secret" text;--> statement-breakpoint
-- Step 2: Backfill client key secrets from apps table
UPDATE "api_keys" SET "secret" = "apps"."client_key" FROM "apps" WHERE "api_keys"."app_id" = "apps"."id" AND "api_keys"."key_type" = 'client';--> statement-breakpoint
-- Step 3: Delete agent/server keys that have no plaintext (unrecoverable)
DELETE FROM "api_keys" WHERE "secret" IS NULL;--> statement-breakpoint
-- Step 4: Now make it NOT NULL
ALTER TABLE "api_keys" ALTER COLUMN "secret" SET NOT NULL;--> statement-breakpoint
-- Step 5: Remove redundant client_key from apps
ALTER TABLE "apps" DROP COLUMN "client_key";
