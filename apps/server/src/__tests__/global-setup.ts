import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupTestDb } from "./setup.js";

// Ensure the server config picks up a test-scoped attachments directory before any
// test code imports config.ts.
const attachmentsTempDir =
  process.env.OWLMETRY_ATTACHMENTS_PATH ||
  mkdtempSync(join(tmpdir(), "owlmetry-attachments-test-"));
process.env.OWLMETRY_ATTACHMENTS_PATH = attachmentsTempDir;
process.env.OWLMETRY_ATTACHMENTS_SIGNING_SECRET =
  process.env.OWLMETRY_ATTACHMENTS_SIGNING_SECRET || "test-attachment-secret";

export async function setup() {
  await setupTestDb();
}

export async function teardown() {
  if (attachmentsTempDir.startsWith(tmpdir())) {
    rmSync(attachmentsTempDir, { recursive: true, force: true });
  }
}
