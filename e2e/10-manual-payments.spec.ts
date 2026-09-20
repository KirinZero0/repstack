import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";

const DAY = 24 * 60 * 60 * 1000;

async function newLapsedMember(gymSlug: string, tag: string) {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: gymSlug } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gym.id } });
  const phone = `0813${Date.now().toString().slice(-8)}`;
  const member = await prisma.member.create({
    data: {
      gymId: gym.id,
      planId: plan.id,
      fullName: `Manual ${tag}`,
      email: `manual-${tag}-${Date.now()}@test.local`,
      phoneWhatsapp: encrypt(phone),
      phoneWhatsappLookup: hmacLookup(phone),
      status: "EXPIRED",
      membershipExpiry: new Date(Date.now() - 3 * DAY),
    },
  });
  return { gym, plan, member };
}

async function loginOwner(request: import("@playwright/test").APIRequestContext, baseURL: string, slug: string, email: string) {
  const res = await request.post(`${baseURL}/api/g/${slug}/staff-login`, { data: { email, password: "owner-pass-123" } });
  expect(res.ok()).toBeTruthy();
}

test("owner records a cash payment: member reactivated, receipt logged, double-submit blocked, then voided", async ({ request, baseURL }) => {
  const { plan, member } = await newLapsedMember("test-gym-a", "cash");
  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  const url = `${baseURL}/api/g/test-gym-a/members/${member.id}/payments`;

  const rec = await request.post(url, { data: { planId: plan.id, amount: 200000, note: "Cash at front desk" } });
  expect(rec.status()).toBe(201);
  const { paymentId } = await rec.json();

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { recordedBy: true } });
  expect(payment.provider).toBe("CASH");
  expect(payment.status).toBe("PAID");
  expect(Number(payment.amount)).toBe(200000); // a discounted amount is allowed
  expect(payment.note).toBe("Cash at front desk");
  expect(payment.recordedBy?.email).toBe("owner-a@test.local");

  // Lapsed member: the period starts from the payment, not from the old expiry.
  const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(after.status).toBe("ACTIVE");
  const days = (after.membershipExpiry!.getTime() - Date.now()) / DAY;
  expect(days).toBeGreaterThan(plan.durationDays - 1);
  expect(days).toBeLessThan(plan.durationDays + 1);
  expect(await prisma.notificationLog.count({ where: { memberId: member.id, type: "payment_receipt" } })).toBe(1);

  // Same entry again straight away is rejected.
  expect((await request.post(url, { data: { planId: plan.id, amount: 200000 } })).status()).toBe(409);

  // Future dates and bad amounts are rejected.
  const tomorrow = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
  expect((await request.post(url, { data: { planId: plan.id, amount: 100000, paidOn: tomorrow } })).status()).toBe(400);
  expect((await request.post(url, { data: { planId: plan.id, amount: 0 } })).status()).toBe(400);

  // Voiding takes the days back and drops it from revenue.
  const voided = await request.post(`${url}/${paymentId}/void`);
  expect(voided.ok()).toBeTruthy();
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("FAILED");
  const reverted = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(reverted.status).toBe("EXPIRED");
  expect(reverted.membershipExpiry!.getTime()).toBeLessThan(Date.now());

  // Can't void twice.
  expect((await request.post(`${url}/${paymentId}/void`)).status()).toBe(409);
});

test("manual payments respect tenant isolation and only manual entries can be voided", async ({ request, baseURL }) => {
  const a = await newLapsedMember("test-gym-a", "iso-a");
  const b = await newLapsedMember("test-gym-b", "iso-b");

  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");

  // Gym A's owner can't touch gym B's member, and can't use gym B's plan.
  const foreignMember = await request.post(`${baseURL}/api/g/test-gym-a/members/${b.member.id}/payments`, { data: { planId: a.plan.id, amount: 100000 } });
  expect(foreignMember.status()).toBe(404);
  const foreignPlan = await request.post(`${baseURL}/api/g/test-gym-a/members/${a.member.id}/payments`, { data: { planId: b.plan.id, amount: 100000 } });
  expect(foreignPlan.status()).toBe(400);
  expect((await prisma.member.findUniqueOrThrow({ where: { id: b.member.id } })).status).toBe("EXPIRED");

  // Gym B's owner can't void a gym A payment via gym A's URL.
  const rec = await request.post(`${baseURL}/api/g/test-gym-a/members/${a.member.id}/payments`, { data: { planId: a.plan.id, amount: 150000 } });
  const { paymentId } = await rec.json();
  await loginOwner(request, baseURL!, "test-gym-b", "owner-b@test.local");
  const cross = await request.post(`${baseURL}/api/g/test-gym-a/members/${a.member.id}/payments/${paymentId}/void`);
  expect(cross.status()).toBe(401);
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PAID");

  // Online (Xendit) payments aren't voidable here.
  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  const online = await prisma.payment.create({
    data: { gymId: a.gym.id, memberId: a.member.id, planId: a.plan.id, provider: "XENDIT", amount: 250000, status: "PAID", paidAt: new Date() },
  });
  expect((await request.post(`${baseURL}/api/g/test-gym-a/members/${a.member.id}/payments/${online.id}/void`)).status()).toBe(409);
});
