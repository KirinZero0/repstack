import { test, expect } from "@playwright/test";
import { prisma, superadminLoginUI } from "./helpers";
import { getPlatformFinance } from "../src/lib/stats";
import { notifyGuest, notifyMember, notifyOwner } from "../src/lib/notify";
import { encrypt, hmacLookup } from "../src/lib/crypto";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

/** A real-looking gym: active, on a monthly plan, with one active member and a paid subscription and setup fee. */
async function makeGym(over: { isTest?: boolean; nextBillingDate?: Date } = {}) {
  const tag = `testgym-${Date.now()}-${seq++}`;
  const saasPlan = await prisma.saasPlan.create({
    data: { name: `TG ${tag}`, price: 777000, billingInterval: "monthly", maxMembers: 100, maxStaff: 3, maxWhatsappPerMonth: 500 },
  });
  const gym = await prisma.gym.create({
    data: { name: `Test Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE", isTest: over.isTest ?? false, nextBillingDate: over.nextBillingDate ?? new Date(Date.now() + 10 * DAY) },
  });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 300000 } });
  const phone = `0813${Date.now().toString().slice(-7)}${seq++}`;
  const member = await prisma.member.create({
    data: { gymId: gym.id, planId: plan.id, fullName: "Tess Ting", email: `${tag}@test.local`, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone), status: "ACTIVE", membershipExpiry: new Date(Date.now() + 20 * DAY) },
  });
  await prisma.platformPayment.create({ data: { gymId: gym.id, saasPlanId: saasPlan.id, provider: "manual", amount: 777000, status: "PAID", paidAt: new Date() } });
  await prisma.platformPayment.create({ data: { gymId: gym.id, saasPlanId: saasPlan.id, provider: "manual", kind: "SETUP", amount: 111000, status: "PAID", paidAt: new Date() } });
  return { gym, member, phone };
}

test("a test gym is left out of every superadmin total, and counts again once it's real", async () => {
  const f = await makeGym({ isTest: true });
  const without = await getPlatformFinance();
  await prisma.gym.update({ where: { id: f.gym.id }, data: { isTest: false } });
  const withIt = await getPlatformFinance();

  expect(withIt.totalGyms - without.totalGyms).toBe(1);
  expect(withIt.activeMembers - without.activeMembers).toBe(1);
  expect(withIt.mrr - without.mrr).toBe(777000);
  expect(withIt.collectedThisMonth - without.collectedThisMonth).toBe(777000);
  expect(withIt.setupFeesCollected - without.setupFeesCollected).toBe(111000);
});

test("a test gym is never billed or suspended by the subscription cron", async ({ request, baseURL }) => {
  const f = await makeGym({ isTest: true, nextBillingDate: new Date(Date.now() - 1 * DAY) });
  const before = await prisma.platformPayment.count({ where: { gymId: f.gym.id } });
  expect((await request.get(`${baseURL}/api/cron/subscriptions`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).ok()).toBeTruthy();
  expect(await prisma.platformPayment.count({ where: { gymId: f.gym.id } })).toBe(before);
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).subscriptionStatus).toBe("ACTIVE");
});

test("a test gym sends nothing automatically, but send buttons still work", async () => {
  const f = await makeGym({ isTest: true });
  const logs = (status: string) => prisma.notificationLog.count({ where: { gymId: f.gym.id, status } });

  // Automatic: member receipt, guest "request received", owner billing email. All skipped, logged.
  expect(await notifyMember(f.gym.id, { to: f.phone, message: "Paid", type: "payment_receipt", memberId: f.member.id })).toEqual({ email: "SKIPPED" });
  expect(await notifyGuest(f.gym.id, { phone: f.phone, email: "g@guest.test", name: "Gail", message: "Got it", type: "field_booking_received", trigger: "auto" })).toEqual({ email: "SKIPPED" });
  expect(await notifyOwner({ gymId: f.gym.id, gymName: f.gym.name, to: { name: "Owner", email: "o@test.local" }, message: "Pay", type: "subscription_due" })).toEqual({ email: "SKIPPED" });
  expect(await logs("SKIPPED")).toBe(3);
  expect(await logs("SENT")).toBe(0);

  // Manual: a staff send button and a staff approval still go out.
  expect((await notifyMember(f.gym.id, { to: f.phone, message: "Reminder", type: "manual_reminder", memberId: f.member.id, trigger: "manual", channel: "email" })).email).toBe("SENT");
  expect((await notifyGuest(f.gym.id, { phone: f.phone, email: "g@guest.test", name: "Gail", message: "Approved", type: "guest_ticket", channel: "email" })).email).toBe("SENT");
  expect(await logs("SENT")).toBe(2);

  // The same automatic message from a real gym does go out.
  const real = await makeGym();
  expect((await notifyMember(real.gym.id, { to: real.phone, message: "Paid", type: "payment_receipt", memberId: real.member.id })).email).toBe("SENT");
});

test("the superadmin marks a gym as test from its settings page, it gets a badge, and the change is audited", async ({ page, baseURL }) => {
  const f = await makeGym();
  await superadminLoginUI(page, baseURL!);
  await page.goto(`${baseURL}/superadmin/gyms/${f.gym.id}`);
  await page.getByLabel("Test gym").check();
  await expect.poll(async () => (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).isTest).toBe(true);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { gymId: f.gym.id, action: "GYM_TEST_FLAG_CHANGED" } });
  expect(audit.metadata).toMatchObject({ isTest: true, was: false });

  await page.goto(`${baseURL}/superadmin/gyms`);
  await expect(page.locator("tr", { hasText: f.gym.name }).getByTestId("test-badge")).toBeVisible();

  // Bad input is refused, and without a superadmin session nobody can flip it.
  expect((await page.context().request.post(`${baseURL}/api/superadmin/gyms/${f.gym.id}/test`, { data: { isTest: "yes" } })).status()).toBe(400);
  await page.context().clearCookies();
  expect((await page.context().request.post(`${baseURL}/api/superadmin/gyms/${f.gym.id}/test`, { data: { isTest: false } })).status()).toBe(401);
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).isTest).toBe(true);
});
