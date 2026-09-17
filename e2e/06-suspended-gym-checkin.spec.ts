import { test, expect } from "@playwright/test";
import { staffLoginUI, buildTokenForMember, prisma } from "./helpers";

test("suspended gym blocks check-in even with an otherwise-valid QR", async ({ page, baseURL }) => {
  await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
  await page.waitForURL(`${baseURL}/g/test-gym-a/dashboard`);

  const member = await prisma.member.findUniqueOrThrow({ where: { email: "active-member@test.local" } });
  const token = await buildTokenForMember(member.id);

  await prisma.gym.update({ where: { id: member.gymId }, data: { subscriptionStatus: "SUSPENDED" } });

  try {
    const res = await page.request.post(`${baseURL}/api/checkin`, { data: { token } });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.result).toBe("GYM_SUSPENDED");
  } finally {
    await prisma.gym.update({ where: { id: member.gymId }, data: { subscriptionStatus: "ACTIVE" } });
  }
});
