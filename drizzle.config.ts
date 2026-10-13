import { defineConfig } from "drizzle-kit";

// Used by `npm run db:generate` to turn src/lib/db/schema.ts into SQL migration files.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
