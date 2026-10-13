import path from "node:path";
import { defineConfig } from "vitest/config";

// REAL API integration tests (cost money). Run with: npm run test:integration
// They are skipped unless RUN_PAID_TESTS=1 and the needed API keys are set.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 15 * 60_000,
  },
});
