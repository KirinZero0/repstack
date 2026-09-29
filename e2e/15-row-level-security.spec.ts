import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./helpers";
import { tenantDb, tenantTransaction, rlsEnforced } from "../src/lib/prisma";

/**
 * These prove Postgres itself keeps gyms apart, independent of any `where gymId` in the app code:
 * the app's restricted role can't see or write another gym's rows even with a deliberately sloppy query.
 */
async function twoGyms() {
  const a = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const b = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-b" } });
  return { a, b };
}

test("RLS is switched on for the app: restricted role, no superuser, no bypass", async () => {
  expect(rlsEnforced).toBe(true);
  const raw = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });
  try {
    const [me] = await raw.$queryRaw<{ user: string; super: boolean; bypass: boolean }[]>`
      SELECT current_user AS "user", r.rolsuper AS super, r.rolbypassrls AS bypass FROM pg_roles r WHERE r.rolname = current_user`;
    expect(me.super).toBe(false);
    expect(me.bypass).toBe(false);

    // No gym set means no rows at all, on every tenant table.
    for (const table of ["Gym", "StaffUser", "MembershipPlan", "Member", "CheckIn", "Payment", "NotificationLog", "WhatsappSenderConfig", "PlatformPayment", "MemberSignup", "GymClass", "ClassSession", "ClassRegistration", "ClassPayment"]) {
      const [row] = await raw.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table}"`);
      expect(Number(row.n), table).toBe(0);
    }

    // And tables the app never needs are not even readable.
    for (const table of ["Superadmin", "AuditLog", "GymSignup", "MagicLink", "PasswordReset", "AppConfig"]) {
      await expect(raw.$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`), table).rejects.toThrow();
    }
  } finally {
    await raw.$disconnect();
  }
});

test("a gym's client sees only its own rows, even with no where clause", async () => {
  const { a, b } = await twoGyms();
  const dbA = tenantDb(a.id);

  const members = await dbA.member.findMany(); // deliberately unscoped
  expect(members.length).toBeGreaterThan(0);
  expect(members.every((m) => m.gymId === a.id)).toBe(true);
  expect((await dbA.membershipPlan.findMany()).every((p) => p.gymId === a.id)).toBe(true);
  expect((await dbA.staffUser.findMany()).every((s) => s.gymId === a.id)).toBe(true);
  expect((await dbA.payment.findMany()).every((p) => p.gymId === a.id)).toBe(true);
  expect((await dbA.checkIn.findMany()).every((c) => c.gymId === a.id)).toBe(true);
  expect((await dbA.gym.findMany()).map((g) => g.id)).toEqual([a.id]);

  // Asking for another gym's row by its exact id finds nothing.
  const bMember = await prisma.member.findFirstOrThrow({ where: { gymId: b.id } });
  expect(await dbA.member.findUnique({ where: { id: bMember.id } })).toBeNull();
  expect(await dbA.member.count({ where: { gymId: b.id } })).toBe(0);

  // Counts match what the owner sees for that gym alone.
  expect(members.length).toBe(await prisma.member.count({ where: { gymId: a.id } }));
});

test("a gym's client can't change or create another gym's rows", async () => {
  const { a, b } = await twoGyms();
  const dbA = tenantDb(a.id);
  const bMember = await prisma.member.findFirstOrThrow({ where: { gymId: b.id } });
  const bPlan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: b.id } });

  // Updating or deleting another gym's row touches nothing.
  const upd = await dbA.member.updateMany({ where: { id: bMember.id }, data: { fullName: "HACKED" } });
  expect(upd.count).toBe(0);
  expect((await dbA.member.deleteMany({ where: { id: bMember.id } })).count).toBe(0);
  expect((await prisma.member.findUniqueOrThrow({ where: { id: bMember.id } })).fullName).not.toBe("HACKED");

  // Creating a row that belongs to another gym is refused by the database.
  await expect(
    dbA.membershipPlan.create({ data: { gymId: b.id, name: "smuggled", durationDays: 1, price: 1 } }),
  ).rejects.toThrow();
  await expect(
    dbA.payment.create({ data: { gymId: b.id, memberId: bMember.id, planId: bPlan.id, provider: "CASH", amount: 1, status: "PAID" } }),
  ).rejects.toThrow();

  // The same holds inside a multi-statement transaction, and nothing partial is left behind.
  await expect(
    tenantTransaction(a.id, async (tx) => {
      await tx.membershipPlan.create({ data: { gymId: a.id, name: "legit-then-rolled-back", durationDays: 1, price: 1 } });
      await tx.membershipPlan.create({ data: { gymId: b.id, name: "smuggled-in-tx", durationDays: 1, price: 1 } });
    }),
  ).rejects.toThrow();
  expect(await prisma.membershipPlan.count({ where: { name: { in: ["legit-then-rolled-back", "smuggled-in-tx", "smuggled"] } } })).toBe(0);
});

test("the running app really connects as the restricted role", async ({ request, baseURL }) => {
  // Make the server open tenant-scoped connections, then look at who is connected.
  await request.post(`${baseURL}/api/test-gym-a/login`, { data: { email: "owner-a@test.local", password: "owner-pass-123" } });
  await request.get(`${baseURL}/test-gym-a/dashboard`);

  const rows = await prisma.$queryRaw<{ usename: string; n: bigint }[]>`
    SELECT usename, count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY usename`;
  const appConnections = rows.find((r) => r.usename === "iron_app");
  expect(appConnections, "no connections from the iron_app role").toBeTruthy();
  expect(Number(appConnections!.n)).toBeGreaterThan(0);
});

test("every table with a gymId column is protected, or deliberately system-only", async () => {
  // System-only tables are never granted to the app role (see prisma/rls.sql).
  const SYSTEM_ONLY = new Set(["AuditLog", "GymSignup"]);
  const rows = await prisma.$queryRaw<{ table_name: string; rls: boolean }[]>`
    SELECT c.table_name, cl.relrowsecurity AS rls
    FROM information_schema.columns c
    JOIN pg_class cl ON cl.relname = c.table_name AND cl.relkind = 'r'
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    WHERE c.table_schema = 'public' AND c.column_name = 'gymId'`;
  expect(rows.length).toBeGreaterThan(5);
  const unprotected = rows.filter((r) => !r.rls && !SYSTEM_ONLY.has(r.table_name)).map((r) => r.table_name);
  expect(unprotected, "add these to prisma/rls.sql (or to SYSTEM_ONLY if the app role must never touch them)").toEqual([]);
});
