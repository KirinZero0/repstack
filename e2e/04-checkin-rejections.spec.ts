import { test, expect } from "@playwright/test";
import { staffLoginUI, buildTokenForMember, prisma } from "./helpers";
import { buildQrToken } from "../src/lib/qr";

test.describe("check-in rejections", () => {
  test("duplicate scan same day", async ({ page, baseURL }) => {
    await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
    await page.waitForURL(`${baseURL}/g/test-gym-a/dashboard`);

    const member = await prisma.member.findUniqueOrThrow({
      where: { email: "duplicate-scan-member@test.local" },
    });
    const token1 = await buildTokenForMember(member.id);

    const first = await page.request.post(`${baseURL}/api/checkin`, { data: { token: token1 } });
    expect((await first.json()).result).toBe("SUCCESS");

    const token2 = await buildTokenForMember(member.id);
    const second = await page.request.post(`${baseURL}/api/checkin`, { data: { token: token2 } });
    expect((await second.json()).result).toBe("DUPLICATE");
  });

  test("expired member is rejected", async ({ page, baseURL }) => {
    await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
    await page.waitForURL(`${baseURL}/g/test-gym-a/dashboard`);

    const member = await prisma.member.findUniqueOrThrow({ where: { email: "expired-member@test.local" } });
    const token = await buildTokenForMember(member.id);

    const res = await page.request.post(`${baseURL}/api/checkin`, { data: { token } });
    expect((await res.json()).result).toBe("EXPIRED");
  });

  test("cross-tenant QR is rejected as INVALID — the tenant-isolation regression test", async ({
    page,
    baseURL,
  }) => {
    await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
    await page.waitForURL(`${baseURL}/g/test-gym-a/dashboard`);

    // Gym B's member, scanned by Gym A's staff session.
    const gymBMember = await prisma.member.findUniqueOrThrow({ where: { email: "gymb-member@test.local" } });
    const crossTenantToken = buildQrToken(
      { gymId: gymBMember.gymId, memberId: gymBMember.id, issuedAt: Date.now() },
      gymBMember.qrSecret,
    );

    const res = await page.request.post(`${baseURL}/api/checkin`, { data: { token: crossTenantToken } });
    expect((await res.json()).result).toBe("INVALID");

    const checkinLogged = await prisma.checkIn.findFirst({
      where: { memberId: gymBMember.id, result: "SUCCESS" },
    });
    expect(checkinLogged).toBeNull();
  });
});
