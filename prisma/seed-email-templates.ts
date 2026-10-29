import { PrismaClient } from "@prisma/client";
import { seedEmailTemplates } from "./email-templates";

const prisma = new PrismaClient();

/**
 * Adds any missing platform default email templates to an existing database (safe to run any time).
 *   npm run db:seed:templates               adds what is missing, keeps anything already there
 *   npm run db:seed:templates -- --overwrite  also resets existing platform templates to the built-in wording
 */
async function main() {
  const r = await seedEmailTemplates(prisma, { overwrite: process.argv.includes("--overwrite") });
  console.log(`created ${r.created.length}, updated ${r.updated.length}, kept ${r.kept.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
