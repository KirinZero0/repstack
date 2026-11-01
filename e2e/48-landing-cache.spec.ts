import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";
import { OVERRIDE_KEY, THEME_KEY } from "../src/lib/theme";

const SUPERADMIN = { email: "superadmin@test.local", password: "superadmin-pass-123" };

test("the landing page keeps its plan prices until a superadmin presses Refresh, and only a superadmin can", async ({ request, baseURL, playwright }) => {
  // Warm the cache, then add a plan behind its back, as a script would.
  expect((await request.get(`${baseURL}/`)).ok()).toBeTruthy();
  const name = `Cachetest${Date.now()}`;
  const plan = await prisma.saasPlan.create({
    data: { name: `${name} Monthly`, price: 987654, billingInterval: "monthly", maxMembers: 10, maxStaff: 1, maxWhatsappPerMonth: 10 },
  });
  try {
    expect(await (await request.get(`${baseURL}/`)).text()).not.toContain(name);

    // Nobody but a superadmin can clear it.
    const anon = await playwright.request.newContext();
    expect((await anon.post(`${baseURL}/api/superadmin/plans/refresh`)).status()).toBe(401);
    await anon.dispose();

    expect((await request.post(`${baseURL}/api/superadmin/login`, { data: SUPERADMIN })).ok()).toBeTruthy();
    const before = new Date();
    expect((await request.post(`${baseURL}/api/superadmin/plans/refresh`)).status()).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "PLAN_PRICES_REFRESHED", createdAt: { gte: new Date(before.getTime() - 1000) } } })).toBeGreaterThan(0);
    expect(await (await request.get(`${baseURL}/`)).text()).toContain(name);

    // The settings page shows what the landing page shows, with the button.
    const settings = await (await request.get(`${baseURL}/superadmin/settings`)).text();
    expect(settings).toContain(name);
    expect(settings).toContain("Refresh plan prices");
  } finally {
    await prisma.saasPlan.update({ where: { id: plan.id }, data: { isActive: false } });
    await request.post(`${baseURL}/api/superadmin/login`, { data: SUPERADMIN });
    await request.post(`${baseURL}/api/superadmin/plans/refresh`);
  }
  expect(await (await request.get(`${baseURL}/`)).text()).not.toContain(name);
});

test("the platform theme is cached too, and saving Appearance takes effect at once", async ({ request, baseURL, playwright }) => {
  const rows = await prisma.appConfig.findMany({ where: { key: { in: [THEME_KEY, OVERRIDE_KEY] } } });
  const was = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  expect((await request.post(`${baseURL}/api/superadmin/login`, { data: SUPERADMIN })).ok()).toBeTruthy();
  const save = (themeDefault: string, allowUserOverride: boolean) =>
    request.post(`${baseURL}/api/superadmin/settings`, { data: { themeDefault, allowUserOverride } });
  // A logged-out visitor with no theme cookie sees the platform default.
  const landingTheme = async () => {
    const anon = await playwright.request.newContext();
    const html = await (await anon.get(`${baseURL}/`)).text();
    await anon.dispose();
    return /<html[^>]*data-theme="(\w+)"/.exec(html)?.[1];
  };
  try {
    expect((await save("light", false)).ok()).toBeTruthy();
    expect(await landingTheme()).toBe("light");
    expect((await save("dark", false)).ok()).toBeTruthy();
    expect(await landingTheme()).toBe("dark");
  } finally {
    await save(typeof was[THEME_KEY] === "string" ? (was[THEME_KEY] as string) : "dark", typeof was[OVERRIDE_KEY] === "boolean" ? (was[OVERRIDE_KEY] as boolean) : true);
  }
});
