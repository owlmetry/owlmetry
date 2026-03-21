import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 5000,
    exclude: ["dist/**", "node_modules/**"],
  },
});
