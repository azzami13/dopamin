import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required");
const sql = postgres(url, { max: 1, prepare: false });
const seedDir = path.join(process.cwd(), "src/db/seed");
try {
  const files = (await fs.readdir(seedDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    await sql.unsafe(await fs.readFile(path.join(seedDir, file), "utf8"));
    console.log(`Applied seed ${file}`);
  }
  console.log("Dopamin seeds completed.");
} finally {
  await sql.end();
}
