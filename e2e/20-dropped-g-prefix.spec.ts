import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

/**
 * Gym pages moved from /g/[slug]/... to /[slug]/... (liftmora.com/slug instead of liftmora.com/g/slug).
 * Old links must still work, forever, since some may already be out in WhatsApp messages or bookmarks.
 */
test("an old /g/[slug]/... link redirects permanently to /[slug]/...", async ({ request, baseURL }) => {
  const page = await request.get(`${baseURL}/g/test-gym-a/login`, { maxRedirects: 0 });
  expect(page.status()).toBe(308);
  expect(new URL(page.headers()["location"], baseURL).pathname).toBe("/test-gym-a/login");

  const followed = await request.get(`${baseURL}/g/test-gym-a/login`);
  expect(followed.ok()).toBeTruthy();
  expect(followed.url()).toBe(`${baseURL}/test-gym-a/login`);

  // The API side redirects too (old links were /api/g/[slug]/...), method and body preserved
  // (308, not 301/302/303), so a POST to an old API URL still works.
  const apiRedirect = await request.post(`${baseURL}/api/g/test-gym-a/staff-login`, {
    data: { email: "owner-a@test.local", password: "owner-pass-123" },
  });
  expect(apiRedirect.ok()).toBeTruthy();
  expect(apiRedirect.url()).toBe(`${baseURL}/api/test-gym-a/staff-login`);
});

test("the redirect can't be tricked into sending someone off-site (open redirect)", async ({ request, baseURL }) => {
  // "/g//evil.com/x" strips down to "//evil.com/x" — read naively that's protocol-relative and
  // would resolve to https://evil.com/x. The Location must always stay on this origin.
  const res = await request.get(`${baseURL}/g//evil.com/x`, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  const location = new URL(res.headers()["location"], baseURL);
  expect(location.origin).toBe(new URL(baseURL!).origin);
  expect(location.host).not.toContain("evil.com");
});

test("a gym slug can't be reserved words that now collide with a top-level page", async ({ request, baseURL }) => {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  // "g" itself is reserved too, but it's shorter than the slug format allows, so it's rejected by
  // format validation before the reserved-word check ever runs — old /g/... links are covered by
  // the middleware redirect regardless, not by this check.
  for (const slug of ["privacy", "terms", "reset", "api", "signup", "login", "forgot"]) {
    const res = await request.post(`${baseURL}/api/signup`, {
      data: {
        saasPlanId: plan.id,
        gymName: "Nope",
        slug,
        ownerName: "Nope",
        ownerEmail: `nope-${slug}-${Date.now()}@signup.test`,
        ownerPhone: "081200007777",
        password: "long-enough-1",
        acceptTerms: true,
      },
    });
    expect(res.status(), slug).toBe(409);
    expect((await res.json()).field, slug).toBe("slug");
  }
});

test("superadmin can't create a gym with a reserved slug either", async ({ request, baseURL }) => {
  await request.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" } });
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const res = await request.post(`${baseURL}/api/superadmin/gyms`, {
    data: {
      gymName: "Nope",
      slug: "privacy",
      saasPlanId: plan.id,
      isLifetime: false,
      ownerName: "Nope",
      ownerEmail: `nope-${Date.now()}@test.local`,
      ownerTempPassword: "long-enough-1",
    },
  });
  expect(res.status()).toBe(409);
  expect(await prisma.gym.findUnique({ where: { slug: "privacy" } })).toBeNull();
});

test("the real gym pages resolve at the shorter address", async ({ request, baseURL }) => {
  const login = await request.get(`${baseURL}/test-gym-a/login`);
  expect(login.ok()).toBeTruthy();
  const dashboard = await request.post(`${baseURL}/api/test-gym-a/staff-login`, {
    data: { email: "owner-a@test.local", password: "owner-pass-123" },
  });
  expect(dashboard.ok()).toBeTruthy();
  const finance = await request.get(`${baseURL}/test-gym-a/finance`);
  expect(finance.ok()).toBeTruthy();
  expect(await finance.text()).toContain("Financials");
});
