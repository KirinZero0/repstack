import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encrypt, hmacLookup } from "../src/lib/crypto";

/**
 * Resets the test database schema and seeds the fixed fixtures every e2e spec relies on.
 * Requires DATABASE_URL to point at a disposable Postgres database — never run against prod.
 */
export default async function globalSetup() {
  execSync("npx prisma db push --force-reset --skip-generate", {
    stdio: "inherit",
    env: process.env,
  });

  const prisma = new PrismaClient();

  const plan = await prisma.saasPlan.create({
    data: {
      name: "Starter Monthly",
      price: 300000,
      billingInterval: "monthly",
      maxMembers: 100,
      maxStaff: 3,
      maxWhatsappPerMonth: 500,
    },
  });

  await prisma.superadmin.create({
    data: {
      name: "Test Superadmin",
      email: "superadmin@test.local",
      passwordHash: await bcrypt.hash("superadmin-pass-123", 10),
    },
  });

  // Gym A: the primary tenant most specs exercise.
  const gymA = await prisma.gym.create({
    data: {
      name: "Test Gym A",
      slug: "test-gym-a",
      saasPlanId: plan.id,
      subscriptionStatus: "ACTIVE",
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.staffUser.create({
    data: {
      gymId: gymA.id,
      name: "Owner A",
      email: "owner-a@test.local",
      passwordHash: await bcrypt.hash("owner-pass-123", 10),
      role: "OWNER",
    },
  });

  const planA = await prisma.membershipPlan.create({
    data: { gymId: gymA.id, name: "Monthly", durationDays: 30, price: 250000 },
  });

  // An already-activated, paid member on Gym A — used by check-in specs.
  const activeMemberPassword = "member-pass-123";
  const memberPhone = "081200000001";
  await prisma.member.create({
    data: {
      gymId: gymA.id,
      planId: planA.id,
      fullName: "Active Member",
      email: "active-member@test.local",
      phoneWhatsapp: encrypt(memberPhone),
      phoneWhatsappLookup: hmacLookup(memberPhone),
      passwordHash: await bcrypt.hash(activeMemberPassword, 10),
      status: "ACTIVE",
      membershipExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // A second active member, dedicated to the duplicate-scan test — kept separate from
  // "Active Member" so that test isn't coupled to whether another spec already checked
  // that member in today (spec files share one seeded DB for the whole run).
  const duplicateTestPhone = "081200000004";
  await prisma.member.create({
    data: {
      gymId: gymA.id,
      planId: planA.id,
      fullName: "Duplicate Scan Member",
      email: "duplicate-scan-member@test.local",
      phoneWhatsapp: encrypt(duplicateTestPhone),
      phoneWhatsappLookup: hmacLookup(duplicateTestPhone),
      passwordHash: await bcrypt.hash("member-pass-123", 10),
      status: "ACTIVE",
      membershipExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // An expired member on Gym A.
  const expiredPhone = "081200000002";
  await prisma.member.create({
    data: {
      gymId: gymA.id,
      planId: planA.id,
      fullName: "Expired Member",
      email: "expired-member@test.local",
      phoneWhatsapp: encrypt(expiredPhone),
      phoneWhatsappLookup: hmacLookup(expiredPhone),
      passwordHash: await bcrypt.hash("expired-pass-123", 10),
      status: "EXPIRED",
      membershipExpiry: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });

  // Gym B: a second tenant, used only for the cross-tenant QR rejection test.
  const gymB = await prisma.gym.create({
    data: {
      name: "Test Gym B",
      slug: "test-gym-b",
      saasPlanId: plan.id,
      subscriptionStatus: "ACTIVE",
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.staffUser.create({
    data: {
      gymId: gymB.id,
      name: "Owner B",
      email: "owner-b@test.local",
      passwordHash: await bcrypt.hash("owner-pass-123", 10),
      role: "OWNER",
    },
  });

  const planB = await prisma.membershipPlan.create({
    data: { gymId: gymB.id, name: "Monthly", durationDays: 30, price: 250000 },
  });

  const crossTenantPhone = "081200000003";
  await prisma.member.create({
    data: {
      gymId: gymB.id,
      planId: planB.id,
      fullName: "Gym B Member",
      email: "gymb-member@test.local",
      phoneWhatsapp: encrypt(crossTenantPhone),
      phoneWhatsappLookup: hmacLookup(crossTenantPhone),
      passwordHash: await bcrypt.hash("member-pass-123", 10),
      status: "ACTIVE",
      membershipExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  // A gym staff can suspend/reactivate in the superadmin flow spec.
  await prisma.gym.create({
    data: {
      name: "Suspend Target Gym",
      slug: "suspend-target",
      saasPlanId: plan.id,
      subscriptionStatus: "ACTIVE",
    },
  });

  await prisma.$disconnect();
}
