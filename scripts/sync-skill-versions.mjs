#!/usr/bin/env node

/**
 * Syncs the version field in all skill file frontmatter to match
 * the @owlmetry/cli package version. Run automatically during publish:cli.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf-8")).version;

const skillFiles = [
  join(ROOT, "skills/owlmetry-cli/SKILL.md"),
  join(ROOT, "skills/owlmetry-node/SKILL.md"),
  join(ROOT, "skills/owlmetry-swift/SKILL.md"),
];

let updated = 0;
for (const file of skillFiles) {
  const content = readFileSync(file, "utf-8");
  const replaced = content.replace(/^version: .+$/m, `version: ${version}`);
  if (replaced !== content) {
    writeFileSync(file, replaced);
    updated++;
  }
}

console.log(`Synced ${updated} skill file(s) to version ${version}`);
