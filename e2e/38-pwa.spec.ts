import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";

let seq = 0;

async function makeGym() {
  const tag = `pwa-${Date.now()}-${seq++}`;
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({ data: { name: `PWA Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE" } });
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "OWNER" } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const phone = `0813${Date.now().toString().slice(-6)}${seq++}`;
  const memberLogin = { email: `m-${tag}@test.local`, password: "member-pass-123" };
  await prisma.member.create({
    data: {
      gymId: gym.id, planId: plan.id, fullName: "PWA Member", email: memberLogin.email, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone),
      passwordHash: await bcrypt.hash(memberLogin.password, 10), status: "ACTIVE", membershipExpiry: new Date(Date.now() + 30 * 86400000),
    },
  });
  return { gym, staff, memberLogin, slug: tag };
}

/** Logs in from its own forwarded IP so the suite-wide login throttle can't interfere. */
async function login(ctx: APIRequestContext, baseURL: string, who: { email: string; password: string }) {
  const headers = { "x-forwarded-for": `10.5.${seq++ % 250}.${Math.floor(Math.random() * 250)}` };
  expect((await ctx.post(`${baseURL}/api/login`, { data: who, headers })).ok()).toBeTruthy();
}

const pngSize = (buf: Buffer) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), isPng: buf.subarray(1, 4).toString() === "PNG" });

test("the web app manifest makes Liftmora installable", async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/manifest.webmanifest`);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toContain("manifest");
  const m = await res.json();
  expect(m).toMatchObject({ name: "Liftmora", short_name: "Liftmora", start_url: "/open", scope: "/", display: "standalone" });
  expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);

  // Browsers need a 192 and a 512 icon, and a maskable one for Android's round/squircle crops.
  const purposes = (size: string) => m.icons.filter((i: { sizes: string }) => i.sizes === size).map((i: { purpose?: string }) => i.purpose);
  expect(purposes("192x192")).toContain("any");
  expect(purposes("512x512")).toEqual(expect.arrayContaining(["any", "maskable"]));
  for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
    const r = await request.get(`${baseURL}${icon.src}`);
    expect(r.ok(), icon.src).toBeTruthy();
    expect(r.headers()["content-type"]).toBe(icon.type);
    const dims = pngSize(await r.body());
    expect(dims.isPng, icon.src).toBeTruthy();
    expect(`${dims.width}x${dims.height}`, icon.src).toBe(icon.sizes);
  }
});

test("pages link the manifest, theme colour and iPhone home-screen icon", async ({ request, baseURL }) => {
  const html = await (await request.get(`${baseURL}/login`)).text();
  expect(html).toContain('rel="manifest"');
  expect(html).toContain('name="theme-color"');
  expect(html).toContain("apple-touch-icon.png");
  expect(html).toContain('name="mobile-web-app-capable"');
  expect(html).toContain('name="apple-mobile-web-app-capable"');
  const apple = await request.get(`${baseURL}/icons/apple-touch-icon.png`);
  expect(pngSize(await apple.body())).toMatchObject({ isPng: true, width: 180, height: 180 });
});

test("the service worker is served fresh, from the site root", async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/sw.js`);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toContain("javascript");
  expect(res.headers()["cache-control"]).toContain("no-cache");
  expect(res.headers()["service-worker-allowed"]).toBe("/");
  const src = await res.text();
  // The privacy promise: it must not store pages or API data, only fixed files and the offline page.
  expect(src).toContain("/offline.html");
  expect(src).toContain('request.method !== "GET"');
  expect(src).not.toMatch(/cache\.put\(request, copy\)[\s\S]*\/api\//); // no API caching path
  const offline = await request.get(`${baseURL}/offline.html`);
  expect(await offline.text()).toContain("You're offline");
});

test("/open sends each kind of user to their own home", async ({ playwright, baseURL }) => {
  const f = await makeGym();
  const where = async (ctx: APIRequestContext) => {
    const r = await ctx.get(`${baseURL}/open`, { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    return new URL(r.headers()["location"], baseURL).pathname;
  };
  const anon = await playwright.request.newContext();
  expect(await where(anon)).toBe("/login");

  const staff = await playwright.request.newContext();
  await login(staff, baseURL!, f.staff);
  expect(await where(staff)).toBe(`/${f.slug}/dashboard`);

  const member = await playwright.request.newContext();
  await login(member, baseURL!, f.memberLogin);
  expect(await where(member)).toBe("/my");

  const admin = await playwright.request.newContext();
  const headers = { "x-forwarded-for": `10.4.${seq++ % 250}.1` };
  expect((await admin.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" }, headers })).ok()).toBeTruthy();
  expect(await where(admin)).toBe("/superadmin/dashboard");
});

test("offline: the service worker shows the offline page, and never stores pages or API data", async ({ page, context, baseURL }) => {
  const f = await makeGym();
  await login(page.request, baseURL!, f.staff); // a signed-in staff session, so there is real private data to NOT cache
  await page.goto(`${baseURL}/${f.slug}/dashboard`);
  await expect(page.getByText("Checked in today")).toBeVisible();

  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  // Wait until the worker controls the page (it claims clients on activate).
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  // Visit a few pages and call an API while online, so anything the worker might wrongly keep would be in there.
  await page.goto(`${baseURL}/${f.slug}/members`);
  await page.evaluate(() => fetch("/api/login", { method: "POST", body: "{}" }).catch(() => undefined));
  await page.goto(`${baseURL}/${f.slug}/dashboard`);

  const stored = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    return urls;
  });
  expect(stored).toContain("/offline.html");
  expect(stored.filter((u) => u.startsWith("/api/") || u.includes(f.slug) || u === "/login")).toEqual([]);
  expect(stored.every((u) => u === "/offline.html" || u.startsWith("/icons/") || u.startsWith("/_next/static/"))).toBeTruthy();

  // Lose the connection: a page load now lands on the offline page instead of the browser's error screen.
  await context.setOffline(true);
  await page.goto(`${baseURL}/${f.slug}/members`).catch(() => undefined);
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByText("PWA Member")).toHaveCount(0); // nothing private is shown from a cache

  // Back online, "Try again" gets the real page.
  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Members" }).first()).toBeVisible();
});

const fireInstallPrompt = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        (window as unknown as { __prompted: boolean }).__prompted = true;
      },
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    window.dispatchEvent(e);
  });

test("install banner: shown inside the app only, installs on tap, and Not now is remembered", async ({ page, baseURL }) => {
  const f = await makeGym();
  await login(page.request, baseURL!, f.staff);

  // Never on the marketing site, even when the browser offers to install.
  await page.goto(`${baseURL}/`);
  await fireInstallPrompt(page);
  await expect(page.getByTestId("install-prompt")).toHaveCount(0);

  await page.goto(`${baseURL}/${f.slug}/dashboard`);
  await fireInstallPrompt(page);
  const banner = page.getByTestId("install-prompt");
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Install", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true);
  await expect(banner).toHaveCount(0);

  // "Not now" hides it and it stays away on the next visit.
  await page.reload();
  await fireInstallPrompt(page);
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await fireInstallPrompt(page);
  await expect(banner).toHaveCount(0);
});

test("iPhone has no install prompt, so the banner explains Add to Home Screen", async ({ browser, baseURL }: { browser: Browser; baseURL?: string }) => {
  const f = await makeGym();
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await login(page.request, baseURL!, f.memberLogin);
  await page.goto(`${baseURL}/my`);
  const banner = page.getByTestId("install-prompt");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Add to Home Screen");
  await expect(page.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
  await ctx.close();
});
