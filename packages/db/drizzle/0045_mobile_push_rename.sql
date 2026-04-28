-- Rename the `ios_push` notification channel to the platform-agnostic
-- `mobile_push`, and add a `platform` column to user_devices so the dispatcher
-- can route per-device (iOS APNs today, Android FCM later) within a single
-- channel. Touches three places where the old value is stored: user_devices.channel,
-- notification_deliveries.channel, and the JSONB key under
-- users.preferences.notifications.types.<type>.ios_push.

-- 1. Add platform column (nullable for backfill), seed with 'ios' since every
--    existing row was registered by the iOS companion app, then enforce NOT NULL.
ALTER TABLE "user_devices" ADD COLUMN "platform" varchar(16);
UPDATE "user_devices" SET "platform" = 'ios' WHERE "platform" IS NULL;
ALTER TABLE "user_devices" ALTER COLUMN "platform" SET NOT NULL;

-- 2. Rename the channel value on existing device rows.
UPDATE "user_devices" SET "channel" = 'mobile_push' WHERE "channel" = 'ios_push';

-- 3. Rename the channel value on historical delivery rows so the audit log stays
--    consistent with the new vocabulary. Append-only table, in-place update.
UPDATE "notification_deliveries" SET "channel" = 'mobile_push' WHERE "channel" = 'ios_push';

-- 4. Rename the JSONB key under preferences.notifications.types.<type>.ios_push
--    to .mobile_push for every user that has any override. Iterates per-user,
--    per-type so we don't have to enumerate the type list in SQL — picks up any
--    type the user happens to have customized.
DO $$
DECLARE
  user_row RECORD;
  type_key TEXT;
BEGIN
  FOR user_row IN
    SELECT "id", "preferences" FROM "users"
    WHERE "preferences"->'notifications'->'types' IS NOT NULL
  LOOP
    FOR type_key IN
      SELECT jsonb_object_keys(user_row."preferences"->'notifications'->'types')
    LOOP
      IF user_row."preferences" #> ARRAY['notifications','types',type_key,'ios_push'] IS NOT NULL THEN
        UPDATE "users"
        SET "preferences" = jsonb_set(
          "preferences" #- ARRAY['notifications','types',type_key,'ios_push'],
          ARRAY['notifications','types',type_key,'mobile_push'],
          "preferences" #> ARRAY['notifications','types',type_key,'ios_push']
        )
        WHERE "id" = user_row."id";
      END IF;
    END LOOP;
  END LOOP;
END $$;
