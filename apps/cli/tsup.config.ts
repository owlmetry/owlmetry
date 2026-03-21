import { defineConfig } from "tsup";
import { cpSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "./package.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  bundle: true,
  clean: true,
  splitting: false,
  minify: false,
  shims: true,
  noExternal: ["@owlmetry/shared", "commander", "chalk", "cli-table3"],
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  onSuccess: async () => {
    const skillsSource = resolve(__dirname, "../../skills");
    const skillsDest = resolve(__dirname, "dist/skills");
    cpSync(skillsSource, skillsDest, { recursive: true });

    chmodSync(resolve(__dirname, "dist/index.cjs"), 0o755);
  },
});
