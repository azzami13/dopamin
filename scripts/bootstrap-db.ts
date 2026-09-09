import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_MIGRATION_URL or DATABASE_URL is required"
  );
}

const sql = postgres(url, {
  max: 1,
  prepare: false,
});

async function apply(file: string) {
  await sql.unsafe(await fs.readFile(file, "utf8"));
  console.log(
    `Applied ${path.relative(process.cwd(), file)}`
  );
}

async function applyDirectory(relativeDir: string) {
  const dir = path.join(
    process.cwd(),
    relativeDir
  );

  const files = (await fs.readdir(dir))
    .filter((x) => x.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await apply(path.join(dir, file));
  }
}

async function main() {
  try {
    await applyDirectory("src/db/migrations");
    await applyDirectory("src/db/views");
    await applyDirectory("src/db/seed");

    console.log(
      "Fresh database bootstrap completed."
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Database bootstrap failed.");
  console.error(error);
  process.exit(1);
});