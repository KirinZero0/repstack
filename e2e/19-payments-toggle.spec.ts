import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";
import { gymPaymentsEnabled, memberPaymentsEnabled } from "../src/lib/gateway";

let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function loginOwner(request: import("@playwright/test").APIRequestContext, baseURL: string, slug: string, email: string) {
  const res = await request.post(`${baseURL}/api/${slug}/staff-login`, { data: { email, password: "owner-pass-123" } });
  expect(res.ok()).toBeTruthy();
}

test("gymPaymentsEnabled / memberPaymentsEnabled read the gym's own settings, off by default", () => {
  expect(gymPaymentsEnabled(null)).toBe(false);
  expect(gymPaymentsEnabled({})).toBe(false);
  expect(gymPaymentsEnabled({ paymentsEnabled: false })).toBe(false);
  expect(gymPaymentsEnabled({ paymentsEnabled: "true" })).toBe(false); // must be a real boolean
  expect(gymPaymentsEnabled({ paymentsEnabled: true })).toBe(true);

  const saved = process.env.PAYMENTS_ENABLED;
  try {
    delete process.env.PAYMENTS_ENABLED;
    expect(memberPaymentsEnabled({ paymentsEnabled: true })).toBe(false); // platform switch still off
    process.env.PAYMENTS_ENABLED = "1";
    expect(memberPaymentsEnabled({ paymentsEnabled: false })).toBe(false); // gym opted out
    expect(memberPaymentsEnabled({ paymentsEnabled: true })).toBe(true); // both on
  } finally {
    if (saved === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = saved;
  }
});

test("owner turns on online payments for their gym; it's off by default and staff/other gyms can't touch it", async ({ request, baseURL, playwright }) => {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  await prisma.gym.update({ where: { id: gym.id }, data: { settings: {} } }); // clean slate

  const page = await request.get(`${baseURL}/test-gym-a/login`); // sanity: app is up
  expect(page.ok()).toBeTruthy();

  // Anonymous can't touch it.
  expect((await request.post(`${baseURL}/api/test-gym-a/settings`, { data: { paymentsEnabled: true } })).status()).toBe(401);

  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  const settingsPageOff = await (await request.get(`${baseURL}/test-gym-a/settings`)).text();
  expect(settingsPageOff).toContain("Let members pay online");

  const on = await request.post(`${baseURL}/api/test-gym-a/settings`, { data: { paymentsEnabled: true } });
  expect(on.ok()).toBeTruthy();
  const row = await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } });
  expect((row.settings as { paymentsEnabled?: boolean }).paymentsEnabled).toBe(true);

  const off = await request.post(`${baseURL}/api/test-gym-a/settings`, { data: { paymentsEnabled: false } });
  expect(off.ok()).toBeTruthy();
  expect(((await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } })).settings as { paymentsEnabled?: boolean }).paymentsEnabled).toBe(false);

  // Turning it back on for gym A doesn't touch gym B, and gym B's owner can't set gym A's.
  await request.post(`${baseURL}/api/test-gym-a/settings`, { data: { paymentsEnabled: true } });
  const otherCtx = await playwright.request.newContext();
  await loginOwner(otherCtx, baseURL!, "test-gym-b", "owner-b@test.local");
  expect((await otherCtx.post(`${baseURL}/api/test-gym-a/settings`, { data: { paymentsEnabled: false } })).status()).toBe(401);
  expect(((await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } })).settings as { paymentsEnabled?: boolean }).paymentsEnabled).toBe(true);
  const gymB = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-b" } });
  expect(((gymB.settings ?? {}) as { paymentsEnabled?: boolean }).paymentsEnabled).not.toBe(true);
  await otherCtx.dispose();

  // Staff can't change it either — only the owner can.
  const bcrypt = (await import("bcryptjs")).default;
  const staffEmail = `${uniq("staff")}@test.local`;
  await prisma.staffUser.create({
    data: { gymId: gym.id, name: "Staffer", email: staffEmail, passwordHash: await bcrypt.hash("staff-pass-123", 10), role: "STAFF" },
  });
  const staffCtx = await playwright.request.newContext();
  await staffCtx.post(`${baseURL}/api/test-gym-a/staff-login`, { data: { email: staffEmail, password: "staff-pass-123" } });
  expect((await staffCtx.post(`${baseURL}/api/test-gym-a/settings`, { data: { paymentsEnabled: false } })).status()).toBe(403);
  expect(((await prisma.gym.findUniqueOrThrow({ where: { id: gym.id } })).settings as { paymentsEnabled?: boolean }).paymentsEnabled).toBe(true);
  await staffCtx.dispose();
});
