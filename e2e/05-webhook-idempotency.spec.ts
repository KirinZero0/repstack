import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

test("firing the same PAID webhook event twice only extends membershipExpiry once", async ({
  page,
  baseURL,
}) => {
  const member = await prisma.member.findUniqueOrThrow({ where: { email: "active-member@test.local" } });
  const expiryBefore = member.membershipExpiry!;

  const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { id: member.planId } });
  const payment = await prisma.payment.create({
    data: {
      gymId: member.gymId,
      memberId: member.id,
      planId: plan.id,
      provider: "XENDIT",
      amount: plan.price,
      status: "PENDING",
    },
  });

  const callbackToken = process.env.XENDIT_CALLBACK_TOKEN!;
  const eventBody = {
    id: "evt_test_1",
    external_id: payment.id,
    status: "PAID",
    paid_at: new Date().toISOString(),
  };

  const first = await page.request.post(`${baseURL}/api/webhooks/xendit`, {
    data: eventBody,
    headers: { "x-callback-token": callbackToken },
  });
  expect(first.ok()).toBeTruthy();

  const afterFirst = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  const expiryAfterFirst = afterFirst.membershipExpiry!;
  expect(expiryAfterFirst.getTime()).toBeGreaterThan(expiryBefore.getTime());

  const second = await page.request.post(`${baseURL}/api/webhooks/xendit`, {
    data: eventBody,
    headers: { "x-callback-token": callbackToken },
  });
  expect(second.ok()).toBeTruthy();

  const afterSecond = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(afterSecond.membershipExpiry!.getTime()).toBe(expiryAfterFirst.getTime());

  const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  expect(paymentAfter.status).toBe("PAID");
});
