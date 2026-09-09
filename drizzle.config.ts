import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations/generated",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
