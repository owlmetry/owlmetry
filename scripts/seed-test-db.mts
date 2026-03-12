import { setupTestDb, truncateAll, seedTestData } from "../apps/server/src/__tests__/setup.js";

async function main() {
  await setupTestDb();
  await truncateAll();
  await seedTestData();
  console.log("Test database seeded");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
