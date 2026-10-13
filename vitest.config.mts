import path from "node:path";
import { defineConfig } from "vitest/config";

// Automated tests: use an in-memory database and FAKE providers.
// They never call fal.ai or Anthropic and never cost money.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" throws outside Next.js; in tests it's just an empty module.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
