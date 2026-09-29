import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

test.describe("global login (/login, /api/login) — no gym address to type", () => {
  test("finds the right gym for a staff account by email alone", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/login`, {
      data: { email: "owner-a@test.local", password: "owner-pass-123" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.kind).toBe("staff");
    expect(body.role).toBe("OWNER");
    expect(body.slug).toBe("test-gym-a");

    // The session actually works on that gym's own pages.
    const dashboard = await request.get(`${baseURL}/test-gym-a/dashboard`);
    expect(dashboard.ok()).toBeTruthy();
  });

  test("finds the right gym for a member account by email alone", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/login`, {
      data: { email: "active-member@test.local", password: "member-pass-123" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.kind).toBe("member");
    expect(body.slug).toBe("test-gym-a");
    expect((await request.get(`${baseURL}/my`)).ok()).toBeTruthy();
  });

  test("owners of two different gyms each land on their own gym, from the exact same form", async ({ request, baseURL, playwright }) => {
    const a = await request.post(`${baseURL}/api/login`, { data: { email: "owner-a@test.local", password: "owner-pass-123" } });
    expect((await a.json()).slug).toBe("test-gym-a");

    const ctxB = await playwright.request.newContext();
    const b = await ctxB.post(`${baseURL}/api/login`, { data: { email: "owner-b@test.local", password: "owner-pass-123" } });
    expect((await b.json()).slug).toBe("test-gym-b");
    await ctxB.dispose();
  });

  test("wrong password and an unknown email get the same generic answer", async ({ request, baseURL }) => {
    const wrongPassword = await request.post(`${baseURL}/api/login`, {
      data: { email: "owner-a@test.local", password: "not-the-password" },
    });
    expect(wrongPassword.status()).toBe(401);
    const unknown = await request.post(`${baseURL}/api/login`, {
      data: { email: `${uniq("nobody")}@test.local`, password: "whatever-1" },
    });
    expect(unknown.status()).toBe(401);
    expect((await wrongPassword.json()).error).toBe((await unknown.json()).error);
  });

  test("a suspended gym blocks login for both staff and members, superadmin-suspended has no billing-only exception", async ({ request, baseURL }) => {
    await request.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" } });
    const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
    await request.post(`${baseURL}/api/superadmin/gyms/${gym.id}/suspend`);

    const staffTry = await request.post(`${baseURL}/api/login`, { data: { email: "owner-a@test.local", password: "owner-pass-123" } });
    expect(staffTry.status()).toBe(403);
    const memberTry = await request.post(`${baseURL}/api/login`, { data: { email: "active-member@test.local", password: "member-pass-123" } });
    expect(memberTry.status()).toBe(403);

    await request.post(`${baseURL}/api/superadmin/gyms/${gym.id}/reactivate`);
  });

  test("an owner of a gym suspended for non-payment can still log in, but only to billing, from the global form", async ({ request, baseURL }) => {
    const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
    const tag = uniq("billingonly");
    const gym = await prisma.gym.create({
      data: { name: `Billing Only ${tag}`, slug: tag, saasPlanId: plan.id, subscriptionStatus: "SUSPENDED", settings: { suspendedFor: "non_payment" } },
    });
    const bcrypt = (await import("bcryptjs")).default;
    const email = `${uniq("owner")}@test.local`;
    await prisma.staffUser.create({
      data: { gymId: gym.id, name: "Owner", email, passwordHash: await bcrypt.hash("owner-pass-123", 10), role: "OWNER" },
    });

    const res = await request.post(`${baseURL}/api/login`, { data: { email, password: "owner-pass-123" } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.billingOnly).toBe(true);
    expect(body.slug).toBe(tag);
    expect((await request.get(`${baseURL}/${tag}/billing`)).ok()).toBeTruthy();
    // Every other gym-scoped route still refuses this session — the page route redirects to login
    // instead of a raw 403, so check an API route, same pattern as the billing-suspension tests.
    const blocked = await request.post(`${baseURL}/api/${tag}/members`, {
      data: { fullName: "Nope", email: `${uniq("nope")}@test.local`, phoneWhatsapp: "081233334444", planId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(blocked.status()).toBe(403);
  });
});

test.describe("global forgot password (/forgot, /api/forgot)", () => {
  test("sends a reset link without knowing the gym, for staff or member, same generic answer either way", async ({ request, baseURL }) => {
    const staffRes = await request.post(`${baseURL}/api/forgot`, { data: { email: "owner-a@test.local" } }, );
    expect(staffRes.ok()).toBeTruthy();
    const staffBody = await staffRes.json();

    const staff = await prisma.staffUser.findUniqueOrThrow({ where: { email: "owner-a@test.local" } });
    expect(await prisma.passwordReset.count({ where: { kind: "staff", subjectId: staff.id, usedAt: null } })).toBeGreaterThan(0);

    const unknownRes = await request.post(`${baseURL}/api/forgot`, { data: { email: `${uniq("nobody")}@test.local` } });
    expect(unknownRes.ok()).toBeTruthy();
    expect(await unknownRes.json()).toEqual(staffBody);
  });
});

test("the landing page links straight to /login; the old gym-slug entry form is gone", async ({ request, baseURL }) => {
  const html = await (await request.get(`${baseURL}/`)).text();
  expect(html).toContain('href="/login"');
  expect(html).not.toContain("gym-slug");
});
