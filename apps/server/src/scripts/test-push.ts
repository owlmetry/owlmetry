/**
 * Direct APNs push test — bypasses dispatcher + adapter to isolate APNs-side issues.
 *
 * Usage on prod:
 *   cd /opt/owlmetry && export $(grep ^DATABASE_URL /opt/owlmetry/.env | head -1)
 *   tsx apps/server/src/scripts/test-push.ts [email]
 *
 * Defaults to the auto-memory user email. Looks up every iOS mobile_push device
 * for that user, picks the matching APNs host per `environment`, sends one push,
 * and prints the raw ApnsResult so we can see status / reason / apnsId.
 */
import { config } from "../config.js";
import { ApnsClient } from "../utils/apns/client.js";
import { createDatabaseConnection } from "@owlmetry/db";
import { sql } from "drizzle-orm";

const targetEmail = process.argv[2] ?? "jayvdb1@gmail.com";

if (!config.apns) {
  console.error("APNs not configured (APNS_KEY_P8 unset?). Cannot test push.");
  process.exit(1);
}

const db = createDatabaseConnection(config.databaseUrl);
const sandbox = new ApnsClient(config.apns, "https://api.sandbox.push.apple.com");
const production = new ApnsClient(config.apns, "https://api.push.apple.com");

console.log(`Target user: ${targetEmail}`);
console.log(`APNs key id: ${config.apns.keyId}, team: ${config.apns.teamId}, bundle: ${config.apns.bundleId}`);

const result = await db.execute<{
  id: string;
  token: string;
  environment: string;
  created_at: Date;
  last_seen_at: Date;
}>(sql`
  SELECT ud.id, ud.token, ud.environment, ud.created_at, ud.last_seen_at
  FROM user_devices ud
  JOIN users u ON ud.user_id = u.id
  WHERE u.email = ${targetEmail} AND ud.channel = 'mobile_push' AND ud.platform = 'ios'
  ORDER BY ud.created_at DESC
`);

if (result.length === 0) {
  console.error(`\nNo iOS mobile_push devices registered for ${targetEmail}.`);
  console.error(`→ Open the Owlmetry iOS app on the device and accept push permission. The app posts the token to /v1/devices on launch.`);
  await sandbox.close();
  await production.close();
  process.exit(2);
}

console.log(`\nFound ${result.length} device(s):`);
for (const row of result) {
  console.log(`  id=${row.id} env=${row.environment} token=${row.token.slice(0, 16)}…  created=${String(row.created_at)}`);
}

for (const row of result) {
  const host = row.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const client = row.environment === "sandbox" ? sandbox : production;
  console.log(`\n→ pushing to ${host} (env=${row.environment}, token=${row.token.slice(0, 20)}…)`);
  const start = Date.now();
  const apnsResult = await client.push(row.token, {
    alert: { title: "Owlmetry debug push", body: `Direct APNs test at ${new Date().toISOString()}` },
    type: "test",
    badge: 1,
  });
  const elapsed = Date.now() - start;
  console.log(`  result (${elapsed}ms): ${JSON.stringify(apnsResult)}`);
}

sandbox.close();
production.close();
process.exit(0);
