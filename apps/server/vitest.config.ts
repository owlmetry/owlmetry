import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
    globalSetup: "./src/__tests__/global-setup.ts",
    exclude: ["dist/**", "node_modules/**"],
  },
});
