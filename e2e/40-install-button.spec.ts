import { test, expect, type Browser, type Page } from "@playwright/test";
import { prisma } from "./helpers";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  iphoneInApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", // WhatsApp, Instagram and friends: no "Safari"
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  firefoxDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  chromeDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

async function visit(browser: Browser, url: string, userAgent: string, init?: () => void): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 }, permissions: ["clipboard-read", "clipboard-write"] });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(url);
  return { page, close: () => ctx.close() };
}

const button = (page: Page) => page.getByTestId("install-app-button");
const guide = (page: Page) => page.getByTestId("install-guide");

test("Chrome/Android with the browser's own prompt: one tap installs, and it disappears once installed", async ({ browser, baseURL }) => {
  const { page, close } = await visit(browser, `${baseURL}/login`, UA.android);
  await expect(button(page)).toBeVisible();
  await page.evaluate(() => {
    const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        (window as unknown as { __prompted: boolean }).__prompted = true;
      },
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    window.dispatchEvent(e);
  });
  await button(page).click();
  expect(await page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true);
  await expect(guide(page)).toHaveCount(0); // no guide needed: the browser's own dialog took over
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(button(page)).toHaveCount(0);
  await close();
});

test("iPhone Safari gets the Share → Add to Home Screen steps", async ({ browser, baseURL }) => {
  const { page, close } = await visit(browser, `${baseURL}/login`, UA.iphoneSafari);
  await button(page).click();
  await expect(guide(page)).toContainText("Share");
  await expect(guide(page)).toContainText("Add to Home Screen");
  await expect(page.getByTestId("copy-link")).toHaveCount(0); // already in Safari, nothing to copy
  await page.keyboard.press("Escape");
  await expect(guide(page)).toHaveCount(0);
  await close();
});

test("iPhone in Chrome or an in-app browser is told to use Safari, with a Copy link button that works", async ({ browser, baseURL }) => {
  for (const ua of [UA.iphoneChrome, UA.iphoneInApp]) {
    const { page, close } = await visit(browser, `${baseURL}/login`, ua);
    await button(page).click();
    await expect(guide(page)).toContainText("only install apps from Safari");
    await expect(guide(page)).toContainText("Add to Home Screen");
    await page.getByTestId("copy-link").click();
    await expect(page.getByTestId("copy-link")).toHaveText("Copied ✓");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/login`);
    await close();
  }
});

test("an iPad (which pretends to be a Mac but has a touch screen) gets the iPhone steps; a real Mac gets Add to Dock", async ({ browser, baseURL }) => {
  const ipad = await visit(browser, `${baseURL}/login`, UA.ipadAsMac, () => Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 }));
  await button(ipad.page).click();
  await expect(guide(ipad.page)).toContainText("Add to Home Screen");
  await expect(guide(ipad.page)).not.toContainText("Add to Dock");
  await ipad.close();

  const mac = await visit(browser, `${baseURL}/login`, UA.macSafari);
  await button(mac.page).click();
  await expect(guide(mac.page)).toContainText("Add to Dock");
  await mac.close();
});

test("Android without a prompt, and Chrome/Edge on a computer, get their own instructions", async ({ browser, baseURL }) => {
  const android = await visit(browser, `${baseURL}/login`, UA.android);
  await button(android.page).click();
  await expect(guide(android.page)).toContainText("Install app");
  await android.close();

  const desktop = await visit(browser, `${baseURL}/login`, UA.chromeDesktop);
  await button(desktop.page).click();
  await expect(guide(desktop.page)).toContainText("address bar");
  await desktop.close();
});

test("no button where it can't help: Firefox on a computer, or an app that's already installed", async ({ browser, baseURL }) => {
  const ff = await visit(browser, `${baseURL}/login`, UA.firefoxDesktop);
  await ff.page.waitForLoadState("networkidle");
  await expect(button(ff.page)).toHaveCount(0);
  await ff.close();

  const installed = await visit(browser, `${baseURL}/login`, UA.android, () => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q.includes("display-mode: standalone") ? ({ ...real(q), matches: true } as MediaQueryList) : real(q));
  });
  await installed.page.waitForLoadState("networkidle");
  await expect(button(installed.page)).toHaveCount(0);
  await installed.close();
});

test("the button is on the login pages (including a gym's own, and the member entry) and not on the marketing site", async ({ browser, baseURL }) => {
  const tag = `inst-${Date.now()}`;
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  await prisma.gym.create({ data: { name: `Install Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE" } });

  for (const path of ["/login", `/${tag}/login`, `/${tag}/member-login`]) {
    const { page, close } = await visit(browser, `${baseURL}${path}`, UA.iphoneSafari);
    await expect(button(page), path).toBeVisible();
    await close();
  }
  const home = await visit(browser, `${baseURL}/`, UA.iphoneSafari);
  await home.page.waitForLoadState("networkidle");
  await expect(button(home.page)).toHaveCount(0);
  await home.close();
});
