import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";
import { sendGymWhatsapp } from "../src/lib/whatsapp";

/** Gyms don't bring their own gateway: messages go out from the platform account, capped per plan. */
test("gym messages send from the platform account and are logged SENT", async () => {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const member = await prisma.member.findFirstOrThrow({ where: { gymId: gym.id } });

  const result = await sendGymWhatsapp(gym.id, { to: "081200004444", message: "hi", type: "e2e_platform_send", memberId: member.id });
  expect(result.ok).toBe(true);
  const log = await prisma.notificationLog.findFirstOrThrow({ where: { gymId: gym.id, type: "e2e_platform_send" } });
  expect(log.status).toBe("SENT");
});

test("a gym over its plan's monthly WhatsApp allowance is not sent to, and logged LIMIT", async () => {
  const plan = await prisma.saasPlan.create({
    data: { name: "Tiny", price: 1, billingInterval: "monthly", maxMembers: 10, maxStaff: 1, maxWhatsappPerMonth: 2 },
  });
  const gym = await prisma.gym.create({
    data: { name: "Tiny Gym", slug: `tiny-${Date.now()}`, saasPlanId: plan.id, subscriptionStatus: "ACTIVE" },
  });
  const memberPlan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "M", durationDays: 30, price: 1 } });
  const member = await prisma.member.create({
    data: { gymId: gym.id, planId: memberPlan.id, fullName: "Tiny Member", email: `tiny-${Date.now()}@test.local`, phoneWhatsapp: "x", phoneWhatsappLookup: `tiny-${Date.now()}` },
  });

  const send = () => sendGymWhatsapp(gym.id, { to: "081200005555", message: "hi", type: "e2e_limit", memberId: member.id });
  expect((await send()).ok).toBe(true);
  expect((await send()).ok).toBe(true);
  const third = await send();
  expect(third.ok).toBe(false);
  expect(third.skipped).toBe(true);

  const statuses = (await prisma.notificationLog.findMany({ where: { gymId: gym.id, type: "e2e_limit" }, orderBy: { sentAt: "asc" } })).map((n) => n.status);
  expect(statuses).toEqual(["SENT", "SENT", "LIMIT"]);
});

test("gym WhatsApp settings routes are gone; the owner settings page shows usage instead", async ({ request, baseURL }) => {
  const login = await request.post(`${baseURL}/api/g/test-gym-a/staff-login`, { data: { email: "owner-a@test.local", password: "owner-pass-123" } });
  expect(login.ok()).toBeTruthy();
  const res = await request.post(`${baseURL}/api/g/test-gym-a/whatsapp`, { data: { provider: "fonnte", senderNumber: "0812", apiKey: "x", isActive: true } });
  expect(res.status()).toBe(404);
  const page = await request.get(`${baseURL}/g/test-gym-a/settings`);
  expect(page.ok()).toBeTruthy();
  expect(await page.text()).toContain("messages used this month");
});
