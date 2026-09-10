import 'dotenv/config';
import fs from 'node:fs';
import postgres from 'postgres';
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) throw new Error('Database belum dikonfigurasi.');
const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(734903004)`;
    const [state] = await tx`select to_regclass('public.access_requests') as requests, to_regclass('public.users_normalized_email_uq') as email_index`;
    if (state.requests && state.email_index) { console.log('Migration 0004 sudah diterapkan.'); return; }
    if (state.requests || state.email_index) throw new Error('Partial migration 0004');
    await tx.unsafe(fs.readFileSync(new URL('../src/db/migrations/0004_access_requests.sql', import.meta.url), 'utf8'));
    console.log('Migration 0004_access_requests diterapkan.');
  });
} catch (error) {
  console.error(error.message?.startsWith('Migration 0004 blocked:') ? error.message : 'Migration 0004 gagal; transaksi dibatalkan. Periksa koneksi atau partial migration.');
  process.exitCode = 1;
} finally { await sql.end(); }
