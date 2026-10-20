import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    hookTimeout: 120000,
    testTimeout: 60000,
    // All test files share one SQLite file — run them sequentially to keep the
    // audit digest chain (and every other shared-state assertion) deterministic.
    fileParallelism: false,
  },
});
