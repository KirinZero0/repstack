import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { PLAN_SEEDS } from "./plans";

const prisma = new PrismaClient();

async function main() {
  const starterMonthly = await prisma.saasPlan.create({
    data: {
      name: "Starter Monthly",
      price: 300000,
      currency: "IDR",
      billingInterval: "monthly",
      maxMembers: 100,
      maxStaff: 3,
      maxWhatsappPerMonth: 500,
    },
  });

  const starterAnnual = await prisma.saasPlan.create({
    data: {
      name: "Starter Annual",
      price: 3000000,
      currency: "IDR",
      billingInterval: "annual",
      maxMembers: 100,
      maxStaff: 3,
      maxWhatsappPerMonth: 500,
    },
  });

  for (const p of PLAN_SEEDS.filter((p) => !p.name.startsWith("Starter"))) {
    await prisma.saasPlan.create({ data: { ...p, currency: "IDR" } });
  }

  const superadminPassword = "changeme123";
  const superadmin = await prisma.superadmin.create({
    data: {
      name: "Repstack Admin",
      email: "admin@ironledger.dev",
      passwordHash: await bcrypt.hash(superadminPassword, 10),
    },
  });

  const demoOwnerPassword = "changeme123";
  const demoGym = await prisma.gym.create({
    data: {
      name: "Demo Gym",
      slug: "demo",
      saasPlanId: starterMonthly.id,
      subscriptionStatus: "ACTIVE",
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const demoOwner = await prisma.staffUser.create({
    data: {
      gymId: demoGym.id,
      name: "Demo Owner",
      email: "owner@demo.ironledger.dev",
      passwordHash: await bcrypt.hash(demoOwnerPassword, 10),
      role: "OWNER",
    },
  });

  const demoMonthlyPlan = await prisma.membershipPlan.create({
    data: {
      gymId: demoGym.id,
      name: "Monthly",
      durationDays: 30,
      price: 250000,
    },
  });

  const demoAnnualPlan = await prisma.membershipPlan.create({
    data: {
      gymId: demoGym.id,
      name: "Annual",
      durationDays: 365,
      price: 2500000,
    },
  });

  const lifetimeOwnerPassword = "changeme123";
  const lifetimeGym = await prisma.gym.create({
    data: {
      name: "Founding Partner Gym",
      slug: "founding-partner",
      saasPlanId: starterAnnual.id,
      isLifetime: true,
      subscriptionStatus: "ACTIVE",
    },
  });

  const lifetimeOwner = await prisma.staffUser.create({
    data: {
      gymId: lifetimeGym.id,
      name: "Lifetime Owner",
      email: "owner@founding-partner.ironledger.dev",
      passwordHash: await bcrypt.hash(lifetimeOwnerPassword, 10),
      role: "OWNER",
    },
  });

  const demoMemberPassword = "changeme123";
  const memberPhone = "081234567890";
  const demoMember = await prisma.member.create({
    data: {
      gymId: demoGym.id,
      planId: demoMonthlyPlan.id,
      fullName: "Test Member",
      phoneWhatsapp: encrypt(memberPhone),
      phoneWhatsappLookup: hmacLookup(memberPhone),
      email: "member@demo.ironledger.dev",
      passwordHash: await bcrypt.hash(demoMemberPassword, 10),
      status: "ACTIVE",
      membershipExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  console.log("\nSeed complete. Created:\n");
  console.log("SaasPlans:");
  console.log(`  ${starterMonthly.name}: ${starterMonthly.id}`);
  console.log(`  ${starterAnnual.name}: ${starterAnnual.id}`);
  console.log("\nSuperadmin login (/superadmin/login):");
  console.log(`  email: ${superadmin.email}`);
  console.log(`  password: ${superadminPassword}`);
  console.log(`  id: ${superadmin.id}`);
  console.log("\nDemo gym (slug: demo) — staff login (/g/demo/login):");
  console.log(`  email: ${demoOwner.email}`);
  console.log(`  password: ${demoOwnerPassword}`);
  console.log(`  gymId: ${demoGym.id}`);
  console.log("\nDemo gym member login (/g/demo/member-login):");
  console.log(`  email: ${demoMember.email}`);
  console.log(`  password: ${demoMemberPassword}`);
  console.log(`  memberId: ${demoMember.id}`);
  console.log("\nLifetime gym (slug: founding-partner) — staff login (/g/founding-partner/login):");
  console.log(`  email: ${lifetimeOwner.email}`);
  console.log(`  password: ${lifetimeOwnerPassword}`);
  console.log(`  gymId: ${lifetimeGym.id}`);
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
