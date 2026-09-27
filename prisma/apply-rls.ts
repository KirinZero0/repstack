/**
 * Creates (or updates) the restricted application role and applies prisma/rls.sql.
 *
 *   APP_DB_PASSWORD=... npm run db:rls
 *
 * Run it with DATABASE_URL pointing at the database OWNER. Re-run after every `prisma db push`
 * or migration that adds tables (a forced reset drops the policies). Then point APP_DATABASE_URL
 * at the role it prints. Environment: APP_DB_ROLE (default iron_app), APP_DB_PASSWORD (required).
 */
import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

async function main() {
  const role = process.env.APP_DB_ROLE ?? "iron_app";
  const password = process.env.APP_DB_PASSWORD;
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(role)) throw new Error("APP_DB_ROLE must be lowercase letters, digits and underscores.");
  if (!password || password.length < 12) throw new Error("Set APP_DB_PASSWORD (at least 12 characters).");

  const prisma = new PrismaClient();
  try {
    // Identifier and password quoting are done by Postgres itself (format %I / %L).
    const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}::text) AS exists`;
    // Postgres only lets an actual superuser touch the SUPERUSER/BYPASSRLS attributes of an
    // EXISTING role, even to re-state a value it already has — a CREATEROLE-holder (which is all
    // a Neon/Supabase owner role is) can only set them at CREATE time. They're set once, at
    // creation, and never need to change again, so the rotate-password path leaves them alone.
    const template = exists
      ? "ALTER ROLE %I WITH LOGIN PASSWORD %L NOCREATEDB NOCREATEROLE"
      : "CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE";
    const [{ sql: roleSql }] = await prisma.$queryRaw<{ sql: string }[]>`SELECT format(${template}::text, ${role}::text, ${password}::text) AS sql`;
    await prisma.$executeRawUnsafe(roleSql);

    const [{ quoted }] = await prisma.$queryRaw<{ quoted: string }[]>`SELECT quote_ident(${role}::text) AS quoted`;
    const file = readFileSync(path.join(__dirname, "rls.sql"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .replace(/\{\{ROLE\}\}/g, quoted);
    const statements = file.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);

    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    console.log(`\nApplied ${statements.length} statements for role "${role}" on database "${db}".`);
    console.log(`Set APP_DATABASE_URL to a connection string for user "${role}" (same host and database).\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
