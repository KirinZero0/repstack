import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";

const DAY = 24 * 60 * 60 * 1000;
const hook = () => ({ "x-callback-token": process.env.XENDIT_CALLBACK_TOKEN! });
const paid = (id: string) => ({ id: `evt_${id}`, external_id: id, status: "PAID", paid_at: new Date().toISOString() });

async function setSignups(request: APIRequestContext, baseURL: string, slug: string, ownerEmail: string, on: boolean) {
  const login = await request.post(`${baseURL}/api/g/${slug}/staff-login`, { data: { email: ownerEmail, password: "owner-pass-123" } });
  expect(login.ok()).toBeTruthy();
  const res = await request.post(`${baseURL}/api/g/${slug}/settings`, { data: { acceptSignups: on } });
  expect(res.ok()).toBeTruthy();
}

let seq = 0;
const details = (planId: string, tag: string) => ({
  planId,
  fullName: `Joiner ${tag}`,
  email: `join-${tag}-${Date.now()}-${seq++}@join.test`,
  phone: `0815${Date.now().toString().slice(-8)}`,
  password: "long-enough-1",
});

test("public sign-up is off by default, then a paid join creates an active member who can log in", async ({ request, baseURL }) => {
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const ip = { "x-forwarded-for": "10.1.0.1" };

  // Off by default: nothing is created.
  const before = await request.post(`${baseURL}/api/g/test-gym-a/join`, { data: details(plan.id, "off"), headers: ip });
  expect(before.status()).toBe(403);

  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);

  const d = details(plan.id, "ok");
  const started = await request.post(`${baseURL}/api/g/test-gym-a/join`, { data: d, headers: ip });
  expect(started.ok()).toBeTruthy();
  const { signupId, invoiceUrl } = await started.json();
  expect(invoiceUrl).toContain(signupId);

  // Nothing exists until it's paid, and they can't log in yet.
  expect(await prisma.member.findUnique({ where: { email: d.email } })).toBeNull();
  const status = () => request.get(`${baseURL}/api/g/test-gym-a/join/${signupId}/status`).then((r) => r.json());
  expect((await status()).status).toBe("PENDING");
  expect((await request.post(`${baseURL}/api/g/test-gym-a/member-login`, { data: { email: d.email, password: d.password } })).status()).toBe(401);

  // Same details again resume the same signup.
  const again = await request.post(`${baseURL}/api/g/test-gym-a/join`, { data: d, headers: ip });
  expect((await again.json()).signupId).toBe(signupId);
  expect(await prisma.memberSignup.count({ where: { email: d.email } })).toBe(1);

  // Payment clears, delivered twice: one member, one payment.
  await request.post(`${baseURL}/api/webhooks/xendit`, { data: paid(signupId), headers: hook() });
  await request.post(`${baseURL}/api/webhooks/xendit`, { data: paid(signupId), headers: hook() });

  const member = await prisma.member.findUniqueOrThrow({ where: { email: d.email } });
  expect(member.gymId).toBe(gymA.id);
  expect(member.status).toBe("ACTIVE");
  expect(member.planId).toBe(plan.id);
  const days = (member.membershipExpiry!.getTime() - Date.now()) / DAY;
  expect(days).toBeGreaterThan(plan.durationDays - 1);
  expect(days).toBeLessThan(plan.durationDays + 1);
  expect(await prisma.member.count({ where: { email: d.email } })).toBe(1);
  const payments = await prisma.payment.findMany({ where: { memberId: member.id } });
  expect(payments).toHaveLength(1);
  expect(payments[0].status).toBe("PAID");
  expect(await prisma.notificationLog.count({ where: { memberId: member.id, type: "member_welcome" } })).toBe(1);
  expect((await status()).status).toBe("COMPLETED");

  // Phone is stored encrypted, and they can log in with the password they chose.
  expect(member.phoneWhatsapp.startsWith("v1:")).toBe(true);
  const login = await request.post(`${baseURL}/api/g/test-gym-a/member-login`, { data: { email: d.email, password: d.password } });
  expect(login.ok()).toBeTruthy();
});

test("join rejects hidden/foreign plans, existing emails and closed gyms", async ({ request, baseURL }) => {
  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const gymB = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-b" } });
  const planA = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const planB = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymB.id } });
  const hidden = await prisma.membershipPlan.create({ data: { gymId: gymA.id, name: "Hidden join", durationDays: 30, price: 99000, isActive: false } });
  const ip = { "x-forwarded-for": "10.1.0.2" };
  const post = (slug: string, body: object) => request.post(`${baseURL}/api/g/${slug}/join`, { data: body, headers: ip });

  // Gym B never turned sign-up on.
  expect((await post("test-gym-b", details(planB.id, "b"))).status()).toBe(403);
  // Gym A's join can't use gym B's plan or a hidden plan.
  expect((await post("test-gym-a", details(planB.id, "x"))).status()).toBe(400);
  expect((await post("test-gym-a", details(hidden.id, "h"))).status()).toBe(400);
  // An email that already has an account (here at gym A, but it could be any gym).
  const taken = await post("test-gym-a", { ...details(planA.id, "t"), email: "active-member@test.local" });
  expect(taken.status()).toBe(409);
  expect((await taken.json()).field).toBe("email");
  // Bad input.
  expect((await post("test-gym-a", { ...details(planA.id, "p"), password: "short" })).status()).toBe(400);
  expect((await post("test-gym-nope", details(planA.id, "n"))).status()).toBe(404);
});

test("a paid join whose email was registered meanwhile is flagged, not duplicated", async ({ request, baseURL }) => {
  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const d = details(plan.id, "race");
  const started = await request.post(`${baseURL}/api/g/test-gym-a/join`, { data: d, headers: { "x-forwarded-for": "10.1.0.3" } });
  const { signupId } = await started.json();

  // Staff adds the same email before the online payment lands.
  const phone = "081200009999";
  await prisma.member.create({
    data: { gymId: gymA.id, planId: plan.id, fullName: "Staff added", email: d.email, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone), status: "PENDING_PAYMENT" },
  });

  await request.post(`${baseURL}/api/webhooks/xendit`, { data: paid(signupId), headers: hook() });
  expect((await prisma.memberSignup.findUniqueOrThrow({ where: { id: signupId } })).status).toBe("CONFLICT");
  expect(await prisma.member.count({ where: { email: d.email } })).toBe(1);
});

test("sign-ups are throttled per IP", async ({ request, baseURL }) => {
  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const ip = { "x-forwarded-for": "10.9.9.9" };

  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await request.post(`${baseURL}/api/g/test-gym-a/join`, { data: details(plan.id, `thr${i}`), headers: ip });
    statuses.push(r.status());
  }
  expect(statuses.slice(0, 5).every((s) => s === 200)).toBeTruthy();
  expect(statuses.slice(5)).toEqual([429, 429]);
});
