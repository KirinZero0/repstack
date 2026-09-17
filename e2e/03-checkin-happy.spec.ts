import { test, expect } from "@playwright/test";
import { staffLoginUI, buildTokenForMember, prisma } from "./helpers";

test("staff scans an active member's QR and gets SUCCESS", async ({ page, baseURL }) => {
  await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
  await page.waitForURL(`${baseURL}/g/test-gym-a/dashboard`);

  const member = await prisma.member.findUniqueOrThrow({ where: { email: "active-member@test.local" } });
  const token = await buildTokenForMember(member.id);

  const res = await page.request.post(`${baseURL}/api/checkin`, { data: { token } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.result).toBe("SUCCESS");

  const checkin = await prisma.checkIn.findFirstOrThrow({
    where: { memberId: member.id, result: "SUCCESS" },
    orderBy: { checkedInAt: "desc" },
  });
  expect(checkin.gymId).toBe(member.gymId);
});
