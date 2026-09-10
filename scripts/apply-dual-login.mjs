import "dotenv/config";
import fs from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Database belum dikonfigurasi.");
const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(734903003)`;
    const columns = await tx`select column_name from information_schema.columns where table_schema='public'
      and table_name='users' and column_name in ('password_hash','must_change_password','password_updated_at','failed_login_attempts','locked_until')`;
    if (columns.length === 5) { console.log("Migration 0003 sudah diterapkan; jalankan db:smoke untuk validasi."); return; }
    if (columns.length) throw new Error("Partial migration");
    await tx.unsafe(fs.readFileSync(new URL('../src/db/migrations/0003_dual_login.sql', import.meta.url), 'utf8'));
    console.log("Migration 0003_dual_login diterapkan.");
  });
} catch { console.error("Migration 0003 gagal; transaksi dibatalkan."); process.exitCode = 1; }
finally { await sql.end(); }
