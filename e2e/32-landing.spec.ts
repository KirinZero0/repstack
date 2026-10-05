import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";
import { FEATURE_GROUPS } from "../src/components/landing/features";

test("the home page summarises the product and links to the full feature list", async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`);
  await expect(page.getByRole("heading", { name: "Know who trained. Know who paid." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Built for how gyms actually run" })).toBeVisible();
  // Six groups on the home page, each with a link into the catalogue.
  for (const id of ["members", "checkin", "payments", "classes", "finance", "member-app"]) {
    await expect(page.locator(`a[href="/features#${id}"]`)).toHaveCount(1);
  }
  await expect(page.getByRole("link", { name: "See every feature →" })).toHaveAttribute("href", "/features");
  await expect(page.getByRole("banner").getByRole("link", { name: "Features" })).toHaveAttribute("href", "/features");
  // Pricing and FAQ still render.
  await expect(page.getByRole("heading", { name: "Pricing that scales with your floor" })).toBeVisible();
  await expect(page.getByText("Do I need my own WhatsApp number?")).toBeVisible();
});

test("/features lists every group and every item in the catalogue", async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/features`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One system for the door, the money and the members.");
  for (const g of FEATURE_GROUPS) {
    await expect(page.locator(`section#${g.id}`).getByRole("heading", { name: g.title, exact: true })).toBeVisible();
    for (const item of g.items) {
      await expect(page.locator(`section#${g.id}`).getByText(item.title, { exact: true })).toBeVisible();
    }
  }
  // The anchor index at the top jumps to each group.
  const nav = page.getByRole("navigation", { name: "Feature groups" });
  await expect(nav.getByRole("link")).toHaveCount(FEATURE_GROUPS.length);
  await nav.getByRole("link", { name: "Classes" }).click();
  await expect(page).toHaveURL(/#classes$/);
});

test("the catalogue is honest about scope: every group has a lede and at least one item", async () => {
  for (const g of FEATURE_GROUPS) {
    expect(g.lede.length).toBeGreaterThan(10);
    expect(g.items.length).toBeGreaterThan(0);
    for (const item of g.items) expect(item.body.length).toBeGreaterThan(40);
  }
});

test("\"features\" is a reserved slug, so a gym can't take the page's address", async ({ request, baseURL }) => {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const res = await request.post(`${baseURL}/api/signup`, {
    data: {
      saasPlanId: plan.id,
      gymName: "Nope",
      slug: "features",
      ownerName: "Nope",
      ownerEmail: `nope-features-${Date.now()}@signup.test`,
      ownerPhone: "081200007777",
      password: "long-enough-1",
      acceptTerms: true,
    },
  });
  expect(res.status()).toBe(409);
  expect((await res.json()).field).toBe("slug");
});
