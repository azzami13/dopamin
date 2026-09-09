import "dotenv/config";
import postgres from "postgres";

async function main() {
  const [emailArg, nameArg, roleArg] = process.argv.slice(2);

  const email = emailArg?.trim().toLowerCase();
  const fullName = nameArg?.trim();
  const role = roleArg?.trim().toUpperCase();

  const allowedRoles = [
    "OWNER",
    "DIRECTOR",
    "MANAGER",
    "CASHIER",
    "KITCHEN",
  ];

  if (
    !email ||
    !fullName ||
    !role ||
    !allowedRoles.includes(role)
  ) {
    console.error(
      'Usage: npm run user:create -- "owner@example.com" "Owner Name" OWNER'
    );
    process.exit(1);
  }

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

  try {
    const roles = await sql<{ id: string }[]>`
      select id
      from roles
      where code = ${role}
        and is_active = true
      limit 1
    `;

    if (!roles[0]) {
      throw new Error(
        `Role ${role} is not seeded/active`
      );
    }

    await sql`
      insert into users (
        role_id,
        email,
        full_name,
        is_active
      )
      values (
        ${roles[0].id},
        ${email},
        ${fullName},
        true
      )
      on conflict (email)
      do update set
        role_id = excluded.role_id,
        full_name = excluded.full_name,
        is_active = true
    `;

    console.log(
      `User ${email} configured as ${role}.`
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Create user failed.");
  console.error(error);
  process.exit(1);
});