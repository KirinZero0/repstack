import { PrismaClient } from "@prisma/client";
import { PLAN_SEEDS } from "./plans";

const prisma = new PrismaClient();

/** Idempotently adds any missing SaaS plans (matched by name) to an existing database. */
async function main() {
  for (const p of PLAN_SEEDS) {
    const existing = await prisma.saasPlan.findFirst({ where: { name: p.name } });
    if (existing) continue;
    await prisma.saasPlan.create({ data: { ...p, currency: "IDR" } });
    console.log("created plan", p.name);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
