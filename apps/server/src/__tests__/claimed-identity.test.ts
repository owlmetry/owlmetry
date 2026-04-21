import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { createDatabaseConnection } from "@owlmetry/db";
import { resolveClaimedUserIds } from "../utils/claimed-identity.js";
import { truncateAll, seedTestData, TEST_DB_URL } from "./setup.js";

const db = createDatabaseConnection(TEST_DB_URL);

let projectId: string;
let otherProjectId: string;

beforeAll(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  otherProjectId = seed.backendProjectId;
});

beforeEach(async () => {
  const client = postgres(TEST_DB_URL, { max: 1 });
  await client`DELETE FROM app_user_apps`;
  await client`DELETE FROM app_users`;
  await client.end();
});

afterAll(async () => {
  // Handled by other suites; nothing to clean up explicitly.
});

async function insertAppUser(
  project: string,
  user_id: string,
  claimed_from: string[] | null,
  is_anonymous = false
) {
  const client = postgres(TEST_DB_URL, { max: 1 });
  await client`
    INSERT INTO app_users (project_id, user_id, is_anonymous, claimed_from)
    VALUES (${project}, ${user_id}, ${is_anonymous}, ${
      claimed_from === null ? null : JSON.stringify(claimed_from)
    }::jsonb)
  `;
  await client.end();
}

describe("resolveClaimedUserIds", () => {
  it("returns an empty map when no ids are provided", async () => {
    const result = await resolveClaimedUserIds(db, projectId, []);
    expect(result.size).toBe(0);
  });

  it("returns an empty map when only real (non-anon) ids are provided", async () => {
    await insertAppUser(projectId, "real_user_1", ["owl_anon_A"]);
    const result = await resolveClaimedUserIds(db, projectId, [
      "real_user_1",
      "another_real",
    ]);
    expect(result.size).toBe(0);
  });

  it("returns an empty map when no app_users rows have claimed_from set", async () => {
    await insertAppUser(projectId, "owl_anon_A", null, true);
    const result = await resolveClaimedUserIds(db, projectId, ["owl_anon_A"]);
    expect(result.size).toBe(0);
  });

  it("resolves a single claimed anon id to its real user id", async () => {
    await insertAppUser(projectId, "real_user_1", ["owl_anon_A"]);
    const result = await resolveClaimedUserIds(db, projectId, ["owl_anon_A"]);
    expect(result.get("owl_anon_A")).toBe("real_user_1");
    expect(result.size).toBe(1);
  });

  it("resolves multiple anon ids across multiple real users in a single query", async () => {
    await insertAppUser(projectId, "real_user_1", ["owl_anon_A", "owl_anon_B"]);
    await insertAppUser(projectId, "real_user_2", ["owl_anon_C"]);
    const result = await resolveClaimedUserIds(db, projectId, [
      "owl_anon_A",
      "owl_anon_B",
      "owl_anon_C",
      "owl_anon_MISSING",
    ]);
    expect(result.get("owl_anon_A")).toBe("real_user_1");
    expect(result.get("owl_anon_B")).toBe("real_user_1");
    expect(result.get("owl_anon_C")).toBe("real_user_2");
    expect(result.has("owl_anon_MISSING")).toBe(false);
    expect(result.size).toBe(3);
  });

  it("does not resolve claimed ids from a different project", async () => {
    await insertAppUser(otherProjectId, "real_user_1", ["owl_anon_A"]);
    const result = await resolveClaimedUserIds(db, projectId, ["owl_anon_A"]);
    expect(result.size).toBe(0);
  });

  it("ignores non-anon ids in the input even when present in claimed_from rows", async () => {
    await insertAppUser(projectId, "real_user_1", ["owl_anon_A"]);
    const result = await resolveClaimedUserIds(db, projectId, [
      "real_user_1",
      "some_real_id",
      "owl_anon_A",
    ]);
    // Only the anon-prefixed id should round-trip.
    expect(result.size).toBe(1);
    expect(result.get("owl_anon_A")).toBe("real_user_1");
  });

  it("deduplicates repeated anon ids in input", async () => {
    await insertAppUser(projectId, "real_user_1", ["owl_anon_A"]);
    const result = await resolveClaimedUserIds(db, projectId, [
      "owl_anon_A",
      "owl_anon_A",
      "owl_anon_A",
    ]);
    expect(result.size).toBe(1);
    expect(result.get("owl_anon_A")).toBe("real_user_1");
  });

  it("handles null/undefined entries in the input array", async () => {
    await insertAppUser(projectId, "real_user_1", ["owl_anon_A"]);
    const result = await resolveClaimedUserIds(db, projectId, [
      null,
      undefined,
      "owl_anon_A",
      null,
    ]);
    expect(result.size).toBe(1);
    expect(result.get("owl_anon_A")).toBe("real_user_1");
  });
});
