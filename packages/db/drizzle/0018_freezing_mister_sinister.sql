-- Backfill: assign orphaned API keys to the team's first owner
UPDATE "api_keys" ak
SET "created_by" = (
  SELECT tm."user_id"
  FROM "team_members" tm
  WHERE tm."team_id" = ak."team_id" AND tm."role" = 'owner'
  ORDER BY tm."joined_at" ASC
  LIMIT 1
)
WHERE ak."created_by" IS NULL;--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
