import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

async function login(request: import("@playwright/test").APIRequestContext, baseURL: string, path: string, email: string, password: string) {
  const res = await request.post(`${baseURL}${path}`, { data: { email, password } });
  expect(res.ok()).toBeTruthy();
}

test("owner creates a plan, member pays for it, webhook applies it once", async ({ request, baseURL }) => {
  // Owner of gym A creates a custom plan.
  await login(request, baseURL!, "/api/test-gym-a/staff-login", "owner-a@test.local", "owner-pass-123");
  const created = await request.post(`${baseURL}/api/test-gym-a/plans`, {
    data: { name: "Quarterly", durationDays: 90, price: 600000 },
  });
  expect(created.status()).toBe(201);
  const { planId } = await created.json();

  // Validation rejects nonsense.
  const bad = await request.post(`${baseURL}/api/test-gym-a/plans`, { data: { name: "x", durationDays: 0, price: 5 } });
  expect(bad.status()).toBe(400);

  // Gym B's owner cannot edit gym A's plan (tenant isolation).
  await login(request, baseURL!, "/api/test-gym-b/staff-login", "owner-b@test.local", "owner-pass-123");
  const cross = await request.patch(`${baseURL}/api/test-gym-a/plans/${planId}`, { data: { price: 1000 } });
  expect(cross.status()).toBe(401); // session belongs to another gym
  const stillThere = await prisma.membershipPlan.findUniqueOrThrow({ where: { id: planId } });
  expect(Number(stillThere.price)).toBe(600000);

  // A gym-A member pays for the new plan.
  const member = await prisma.member.findUniqueOrThrow({ where: { email: "active-member@test.local" } });
  await login(request, baseURL!, "/api/test-gym-a/member-login", "active-member@test.local", "member-pass-123");
  const pay = await request.post(`${baseURL}/api/pay`, { data: { planId } });
  expect(pay.ok()).toBeTruthy();
  const { invoiceUrl } = await pay.json();
  const paymentId = new URL(invoiceUrl, "http://x").searchParams.get("mock-invoice")!;
  expect(paymentId).toBeTruthy();

  // Asking again resumes the same unpaid invoice instead of creating a duplicate.
  const again = await request.post(`${baseURL}/api/pay`, { data: { planId } });
  expect((await again.json()).invoiceUrl).toBe(invoiceUrl);
  expect(await prisma.payment.count({ where: { memberId: member.id, planId } })).toBe(1);

  // A plan from another gym can't be bought.
  const planB = await prisma.membershipPlan.findFirstOrThrow({ where: { gym: { slug: "test-gym-b" } } });
  const foreign = await request.post(`${baseURL}/api/pay`, { data: { planId: planB.id } });
  expect(foreign.status()).toBe(400);

  // Payment clears (delivered twice): membership extends once and switches to the new plan.
  const before = (await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).membershipExpiry!;
  const event = { id: "evt_plan_1", external_id: paymentId, status: "PAID", paid_at: new Date().toISOString() };
  const headers = { "x-callback-token": process.env.XENDIT_CALLBACK_TOKEN! };
  await request.post(`${baseURL}/api/webhooks/xendit`, { data: event, headers });
  await request.post(`${baseURL}/api/webhooks/xendit`, { data: event, headers });

  const after = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(after.planId).toBe(planId);
  expect(after.membershipExpiry!.getTime() - before.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
});

test("hidden plans can't be bought", async ({ request, baseURL }) => {
  await login(request, baseURL!, "/api/test-gym-a/staff-login", "owner-a@test.local", "owner-pass-123");
  const created = await request.post(`${baseURL}/api/test-gym-a/plans`, {
    data: { name: "Hidden", durationDays: 30, price: 100000, isActive: false },
  });
  const { planId } = await created.json();

  await login(request, baseURL!, "/api/test-gym-a/member-login", "active-member@test.local", "member-pass-123");
  const pay = await request.post(`${baseURL}/api/pay`, { data: { planId } });
  expect(pay.status()).toBe(400);
});
