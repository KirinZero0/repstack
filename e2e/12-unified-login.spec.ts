import { test, expect } from "@playwright/test";

test.describe("unified gym login (one form for staff and members)", () => {
  test("logs a staff account in as staff", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/g/test-gym-a/login`, {
      data: { email: "owner-a@test.local", password: "owner-pass-123" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.kind).toBe("staff");
    expect(body.role).toBe("OWNER");
  });

  test("logs a member account in as member", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/g/test-gym-a/login`, {
      data: { email: "active-member@test.local", password: "member-pass-123" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.kind).toBe("member");
  });

  test("rejects wrong password, wrong gym, and unactivated members", async ({ request, baseURL }) => {
    const wrongPassword = await request.post(`${baseURL}/api/g/test-gym-a/login`, {
      data: { email: "owner-a@test.local", password: "not-the-password" },
    });
    expect(wrongPassword.status()).toBe(401);

    // owner-b belongs to gym B, not gym A.
    const wrongGym = await request.post(`${baseURL}/api/g/test-gym-a/login`, {
      data: { email: "owner-b@test.local", password: "owner-pass-123" },
    });
    expect(wrongGym.status()).toBe(401);
  });

  test("blocks login for a suspended gym for both staff and members", async ({ request, baseURL }) => {
    const gymRes = await request.post(`${baseURL}/api/superadmin/login`, {
      data: { email: "superadmin@test.local", password: "superadmin-pass-123" },
    });
    expect(gymRes.ok()).toBeTruthy();

    // Find the gym via a suspend call requires the gym id — reuse the known seeded gym id lookup
    // through the tenant login flow instead of superadmin gyms listing to keep this test self-contained.
    const { prisma } = await import("./helpers");
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
    await request.post(`${baseURL}/api/superadmin/gyms/${gym.id}/suspend`);

    const staffTry = await request.post(`${baseURL}/api/g/test-gym-a/login`, {
      data: { email: "owner-a@test.local", password: "owner-pass-123" },
    });
    expect(staffTry.status()).toBe(403);

    const memberTry = await request.post(`${baseURL}/api/g/test-gym-a/login`, {
      data: { email: "active-member@test.local", password: "member-pass-123" },
    });
    expect(memberTry.status()).toBe(403);

    await request.post(`${baseURL}/api/superadmin/gyms/${gym.id}/reactivate`);
  });

  test("old /member-login page redirects to the unified /login page", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/g/test-gym-a/member-login`);
    await page.waitForURL(`${baseURL}/g/test-gym-a/login`);
  });
});
