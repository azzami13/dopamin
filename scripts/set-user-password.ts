import "dotenv/config";
import postgres from "postgres";
import { emitKeypressEvents } from "node:readline";
import { hashPassword, validPassword, PASSWORD_RULE } from "../src/lib/auth/password";

async function hidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Terminal interaktif diperlukan.");
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  const previousRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function done(cancelled: boolean) {
      process.stdin.removeListener("keypress", keypress);
      process.stdin.setRawMode(previousRaw);
      process.stdin.pause();
      process.stdout.write("\n");
      if (cancelled) reject(new Error("Dibatalkan.")); else resolve(value);
      value = "";
    }
    function keypress(text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) {
      if (key.ctrl && key.name === "c") return done(true);
      if (key.name === "return" || key.name === "enter") return done(false);
      if (key.name === "backspace") value = [...value].slice(0, -1).join("");
      else if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    }
    process.stdin.on("keypress", keypress);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--email" || !args[1]?.includes("@")) {
    console.error("Usage: npm run user:set-password -- --email user@example.com");
    process.exitCode = 1; return;
  }
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Database belum dikonfigurasi.");
  console.log(PASSWORD_RULE);
  let password = await hidden("Password baru: ");
  if (!validPassword(password)) { console.error(PASSWORD_RULE); process.exitCode = 1; return; }
  let confirmation = await hidden("Ulangi password: ");
  if (password !== confirmation) { console.error("Password tidak sama."); process.exitCode = 1; return; }
  const passwordHash = await hashPassword(password);
  password = confirmation = "";
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      const [user] = await tx`select u.id from users u join roles r on r.id = u.role_id
        where lower(trim(u.email)) = ${args[1].trim().toLowerCase()} and u.is_active and r.is_active for update of u`;
      if (!user) throw new Error("User aktif tidak ditemukan.");
      await tx`update users set password_hash = ${passwordHash}, must_change_password = true,
        password_updated_at = greatest(clock_timestamp(), coalesce(password_updated_at, '-infinity'::timestamptz) + interval '1 millisecond'),
        failed_login_attempts = 0, locked_until = null where id = ${user.id}`;
      await tx`insert into audit_logs (action, module, entity_type, entity_id, source)
        values ('PASSWORD_SET', 'AUTH', 'user', ${user.id}, 'SYSTEM')`;
    });
    console.log("Password disimpan. User wajib mengganti password setelah login.");
  } finally { await sql.end(); }
}
main().catch(() => { console.error("Password tidak disimpan. Periksa input, user aktif, dan koneksi database."); process.exitCode = 1; });
