DROP INDEX "api_keys_key_prefix_idx";--> statement-breakpoint
CREATE INDEX "api_keys_secret_idx" ON "api_keys" USING btree ("secret");--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "key_hash";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "key_prefix";