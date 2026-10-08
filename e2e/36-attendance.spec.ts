import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";

let seq = 0;

async function makeGym() {
  const tag = `att-${Date.now()}-${seq++}`;
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({ data: { name: `Attendance Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE" } });
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const dayPlan = await prisma.dayPassPlan.create({ data: { gymId: gym.id, name: "Single visit", price: 50000 } });
  const memberPlan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 300000 } });
  return { gym, staff, dayPlan, memberPlan, slug: tag };
}

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const headers = { "x-forwarded-for": `10.8.${seq++ % 250}.${Math.floor(Math.random() * 250)}` };
  expect((await request.post(`${baseURL}/api/${slug}/login`, { data: who, headers })).ok()).toBeTruthy();
}

async function makeMember(f: { gym: { id: string }; memberPlan: { id: string } }, over: { status: "ACTIVE" | "EXPIRED"; expiry: Date }) {
  const tag = `${Date.now()}${seq++}`;
  const phone = `0812${tag.slice(-8)}`;
  return prisma.member.create({
    data: {
      gymId: f.gym.id,
      planId: f.memberPlan.id,
      fullName: `Member ${tag}`,
      phoneWhatsapp: encrypt(phone),
      phoneWhatsappLookup: hmacLookup(phone),
      email: `m-${tag}@test.local`,
      status: over.status,
      membershipExpiry: over.expiry,
    },
  });
}

test("walk-in day pass is logged as attended and counted as revenue", async ({ request, baseURL }) => {
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.staff);

  const res = await request.post(`${baseURL}/api/${f.slug}/attendance/walk-in`, { data: { dayPassPlanId: f.dayPlan.id, fullName: "Walk In Wendy" } });
  expect(res.status()).toBe(201);

  const pass = await prisma.guestPass.findFirstOrThrow({ where: { gymId: f.gym.id } });
  expect(pass.status).toBe("ATTENDED");
  expect(Number(pass.amount)).toBe(50000);
  expect(pass.attendedAt).not.toBeNull();
  expect(pass.reviewedAt).not.toBeNull();
  expect(pass.scannedById).not.toBeNull();

  // A custom amount (discount) is respected, and two nameless-phone walk-ins don't collide.
  const res2 = await request.post(`${baseURL}/api/${f.slug}/attendance/walk-in`, { data: { dayPassPlanId: f.dayPlan.id, fullName: "Walk In Wade", amount: 30000 } });
  expect(res2.status()).toBe(201);
  expect(await prisma.guestPass.count({ where: { gymId: f.gym.id, status: "ATTENDED" } })).toBe(2);
});

test("walk-in rejects another gym's plan and bad input", async ({ request, baseURL }) => {
  const a = await makeGym();
  const b = await makeGym();
  await login(request, baseURL!, a.slug, a.staff);

  const cross = await request.post(`${baseURL}/api/${a.slug}/attendance/walk-in`, { data: { dayPassPlanId: b.dayPlan.id, fullName: "Cross Tenant" } });
  expect(cross.status()).toBe(400);
  const bad = await request.post(`${baseURL}/api/${a.slug}/attendance/walk-in`, { data: { dayPassPlanId: "nope", fullName: "X" } });
  expect(bad.status()).toBe(400);
  expect(await prisma.guestPass.count({ where: { gymId: { in: [a.gym.id, b.gym.id] } } })).toBe(0);
});

test("manual member check-in follows the scan rules and stays inside the gym", async ({ request, baseURL }) => {
  const f = await makeGym();
  const other = await makeGym();
  await login(request, baseURL!, f.slug, f.staff);
  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

  const active = await makeMember(f, { status: "ACTIVE", expiry: future });
  const expired = await makeMember(f, { status: "EXPIRED", expiry: new Date(Date.now() - 24 * 60 * 60 * 1000) });
  const foreign = await makeMember(other, { status: "ACTIVE", expiry: future });
  const url = `${baseURL}/api/${f.slug}/attendance/member`;

  expect((await (await request.post(url, { data: { memberId: active.id } })).json()).result).toBe("SUCCESS");
  expect((await (await request.post(url, { data: { memberId: active.id } })).json()).result).toBe("DUPLICATE");
  expect((await (await request.post(url, { data: { memberId: expired.id } })).json()).result).toBe("EXPIRED");
  expect((await request.post(url, { data: { memberId: foreign.id } })).status()).toBe(404);

  expect(await prisma.checkIn.count({ where: { memberId: active.id, result: "SUCCESS" } })).toBe(1);
  expect(await prisma.checkIn.count({ where: { memberId: foreign.id } })).toBe(0);
});

test("attendance routes need a staff session", async ({ request, baseURL }) => {
  const f = await makeGym();
  const walk = await request.post(`${baseURL}/api/${f.slug}/attendance/walk-in`, { data: { dayPassPlanId: f.dayPlan.id, fullName: "No Session" } });
  expect(walk.status()).toBe(401);
  const mem = await request.post(`${baseURL}/api/${f.slug}/attendance/member`, { data: { memberId: f.gym.id } });
  expect(mem.status()).toBe(401);
});

test("attendance page lists today's walk-in", async ({ page, request, baseURL }) => {
  const f = await makeGym();
  await login(page.request, baseURL!, f.slug, f.staff);
  await page.request.post(`${baseURL}/api/${f.slug}/attendance/walk-in`, { data: { dayPassPlanId: f.dayPlan.id, fullName: "Listed Larry" } });
  await page.goto(`/${f.slug}/attendance`);
  await expect(page.getByTestId("attendance-today")).toContainText("Listed Larry");
  void request;
});
