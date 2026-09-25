/**
 * Production-safe superadmin management. Unlike `db:seed`, this creates no demo data.
 *
 *   npm run admin -- create --email you@example.com --name "Your Name"
 *   npm run admin -- reset-password --email you@example.com
 *
 * The password comes from the SUPERADMIN_PASSWORD env var (never a CLI flag, so it stays out of
 * shell history and process listings). Minimum 12 characters.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function main() {
  const command = process.argv[2];
  const email = arg("email")?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!command || !["create", "reset-password"].includes(command)) {
    fail("Usage: npm run admin -- <create|reset-password> --email <email> [--name <name>]\nSet SUPERADMIN_PASSWORD in the environment.");
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) fail("Provide a valid --email.");
  if (!password) fail("Set the SUPERADMIN_PASSWORD environment variable.");
  if (password.length < 12) fail("SUPERADMIN_PASSWORD must be at least 12 characters.");

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.superadmin.findUnique({ where: { email } });

  if (command === "create") {
    if (existing) fail(`A superadmin with ${email} already exists. Use reset-password to change its password.`);
    const name = arg("name")?.trim();
    if (!name) fail("Provide --name for a new superadmin.");
    const created = await prisma.superadmin.create({ data: { name, email, passwordHash } });
    console.log(`\nCreated superadmin ${created.email}. Log in at /superadmin/login.\n`);
  } else {
    if (!existing) fail(`No superadmin with ${email}.`);
    await prisma.superadmin.update({ where: { id: existing.id }, data: { passwordHash } });
    console.log(`\nPassword updated for ${email}. Existing sessions stay valid until they expire (7 days).\n`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
