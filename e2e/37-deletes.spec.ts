import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { ticketTokenFor } from "../src/lib/guestPass";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

/** A gym with an owner, a staff member, a membership plan, a class with one upcoming session and a day-pass plan. */
async function makeGym() {
  const tag = `del-${Date.now()}-${seq++}`;
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({ data: { name: `Delete Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE" } });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  const staffRow = await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const cls = await prisma.gymClass.create({ data: { gymId: gym.id, name: "Yoga", price: 40000, durationMinutes: 60 } });
  const session = await prisma.classSession.create({ data: { gymId: gym.id, classId: cls.id, startsAt: new Date(Date.now() + 30 * 60 * 1000) } });
  const dayPlan = await prisma.dayPassPlan.create({ data: { gymId: gym.id, name: "Single visit", price: 50000 } });
  return { gym, owner, staff, staffRow, plan, cls, session, dayPlan, slug: tag };
}
type Fixture = Awaited<ReturnType<typeof makeGym>>;

async function member(f: Fixture, n: string) {
  const phone = `0813${Date.now().toString().slice(-6)}${seq++}`;
  return prisma.member.create({
    data: {
      gymId: f.gym.id, planId: f.plan.id, fullName: `Member ${n}`, email: `m-${n}-${f.slug}@test.local`, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone),
      passwordHash: await bcrypt.hash("member-pass-123", 10), status: "ACTIVE", membershipExpiry: new Date(Date.now() + 30 * DAY),
    },
  });
}

/** Logs in from its own forwarded IP, so the suite-wide login throttle can't interfere. */
async function login(ctx: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const headers = { "x-forwarded-for": `10.8.${seq++ % 250}.${Math.floor(Math.random() * 250)}` };
  expect((await ctx.post(`${baseURL}/api/${slug}/login`, { data: who, headers })).ok()).toBeTruthy();
}

const pass = (f: Fixture, over: object = {}) =>
  prisma.guestPass.create({
    data: { gymId: f.gym.id, dayPassPlanId: f.dayPlan.id, fullName: "Guest", phoneWhatsapp: encrypt("081200000000"), phoneWhatsappLookup: `g-${seq++}`, amount: 50000, ...over },
  });

test("a mistaken check-in can be removed, freeing the member's day; other gyms can't touch it", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const other = await makeGym();
  const m = await member(f, "a");
  const ci = await prisma.checkIn.create({ data: { gymId: f.gym.id, memberId: m.id, result: "SUCCESS" } });

  await login(request, baseURL!, other.slug, other.staff);
  expect((await request.delete(`${baseURL}/api/${other.slug}/checkins/${ci.id}`)).status()).toBe(404);
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect(await (await staffCtx.get(`${baseURL}/${f.slug}/dashboard`)).text()).toContain("Remove");
  expect((await staffCtx.delete(`${baseURL}/api/${f.slug}/checkins/${ci.id}`)).ok()).toBeTruthy();
  expect(await prisma.checkIn.count({ where: { id: ci.id } })).toBe(0);
  expect((await staffCtx.delete(`${baseURL}/api/${f.slug}/checkins/${ci.id}`)).status()).toBe(404);
  // Their check-in for the day is free again.
  const again = await staffCtx.post(`${baseURL}/api/${f.slug}/attendance/member`, { data: { memberId: m.id } });
  expect((await again.json()).result).toBe("SUCCESS");
});

test("guest requests: unpaid ones can be deleted by staff, paid ones only voided by the owner", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  await login(request, baseURL!, f.slug, f.owner);
  const del = (ctx: APIRequestContext, id: string) => ctx.delete(`${baseURL}/api/${f.slug}/guest-passes/${id}`);
  const act = (ctx: APIRequestContext, id: string, action: string) => ctx.post(`${baseURL}/api/${f.slug}/guest-passes/${id}`, { data: { action } });

  // A waiting request and a declined one are just deleted; so is a free ticket even after approval.
  const waiting = await pass(f, { status: "PENDING_REVIEW" });
  const declined = await pass(f, { status: "REJECTED" });
  const free = await pass(f, { status: "APPROVED", amount: 0 });
  for (const p of [waiting, declined, free]) expect((await del(staffCtx, p.id)).ok(), p.status).toBeTruthy();
  expect(await prisma.guestPass.count({ where: { gymId: f.gym.id } })).toBe(0);

  // A paid ticket is money: it can't be deleted, only voided, and only by the owner.
  const paid = await pass(f, { status: "APPROVED", reviewedAt: new Date() });
  expect((await del(request, paid.id)).status()).toBe(409);
  expect((await act(staffCtx, paid.id, "void")).status()).toBe(403);
  const token = ticketTokenFor(paid);
  const owner = { email: f.owner.email, password: f.owner.password };
  const csv = async () => (await request.get(`${baseURL}/api/${f.slug}/finance/export?report=transactions`)).text();
  expect(await csv()).toContain("Guest (guest)");
  expect((await act(request, paid.id, "void")).ok()).toBeTruthy();
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("VOIDED");
  expect(await csv()).not.toContain("Guest (guest)"); // out of revenue
  await login(staffCtx, baseURL!, f.slug, f.staff);
  const scan = await (await staffCtx.post(`${baseURL}/api/checkin`, { data: { token } })).json();
  expect(scan.result).toBe("INVALID"); // the old QR is dead
  expect((await del(request, paid.id)).status()).toBe(409); // the voided record stays
  expect((await act(request, paid.id, "void")).status()).toBe(409); // and can't be voided twice
  expect(owner.email).toBeTruthy();

  // Other gyms' passes are out of reach.
  const other = await makeGym();
  const theirs = await pass(other, { status: "PENDING_REVIEW" });
  expect((await del(request, theirs.id)).status()).toBe(404);
});

test("day-pass plans: delete when nobody used it, hide otherwise; owner only", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const used = await prisma.dayPassPlan.create({ data: { gymId: f.gym.id, name: "Used plan", price: 1000 } });
  await pass(f, { dayPassPlanId: used.id, status: "PENDING_REVIEW" });
  const url = (id: string) => `${baseURL}/api/${f.slug}/day-pass-plans/${id}`;

  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.delete(url(f.dayPlan.id))).status()).toBe(403);
  await login(request, baseURL!, f.slug, f.owner);
  expect((await request.delete(url(used.id))).status()).toBe(409);
  expect(await prisma.dayPassPlan.count({ where: { id: used.id } })).toBe(1);
  expect((await request.delete(url(f.dayPlan.id))).ok()).toBeTruthy();
  expect(await prisma.dayPassPlan.count({ where: { id: f.dayPlan.id } })).toBe(0);

  const other = await makeGym();
  expect((await request.delete(`${baseURL}/api/${f.slug}/day-pass-plans/${other.dayPlan.id}`)).status()).toBe(404);
  expect(await prisma.dayPassPlan.count({ where: { id: other.dayPlan.id } })).toBe(1);
});

test("a class payment entered by mistake can be undone by the owner, and re-entered correctly", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const m = await member(f, "c");
  const reg = await prisma.classRegistration.create({ data: { gymId: f.gym.id, sessionId: f.session.id, memberId: m.id, status: "PENDING_PAYMENT" } });
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  await login(request, baseURL!, f.slug, f.owner);
  const confirm = (amount: number) => request.post(`${baseURL}/api/${f.slug}/class-registrations/${reg.id}/confirm`, { data: { amount } });
  const voidIt = (ctx: APIRequestContext) => ctx.post(`${baseURL}/api/${f.slug}/class-registrations/${reg.id}/void`);

  expect((await voidIt(request)).status()).toBe(409); // nothing to undo yet
  expect((await confirm(400000)).ok()).toBeTruthy(); // typo'd amount
  expect((await voidIt(staffCtx)).status()).toBe(403);
  expect((await voidIt(request)).ok()).toBeTruthy();
  let row = await prisma.classRegistration.findUniqueOrThrow({ where: { id: reg.id }, include: { payment: true } });
  expect(row.status).toBe("PENDING_PAYMENT");
  expect(row.payment?.status).toBe("FAILED");
  expect((await voidIt(request)).status()).toBe(409);

  expect((await confirm(40000)).ok()).toBeTruthy(); // the right amount
  row = await prisma.classRegistration.findUniqueOrThrow({ where: { id: reg.id }, include: { payment: true } });
  expect(row.status).toBe("CONFIRMED");
  expect(Number(row.payment?.amount)).toBe(40000);

  // An online payment can't be undone here: it's refunded through the provider.
  await prisma.classPayment.update({ where: { id: row.payment!.id }, data: { provider: "XENDIT" } });
  expect((await voidIt(request)).status()).toBe(409);
});

test("a member added by mistake can be deleted, but not one with history", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const other = await makeGym();
  const clean = await member(f, "clean");
  const paid = await member(f, "paid");
  await prisma.payment.create({ data: { gymId: f.gym.id, memberId: paid.id, planId: f.plan.id, provider: "CASH", amount: 250000, status: "PAID", paidAt: new Date() } });
  const visited = await member(f, "visited");
  await prisma.checkIn.create({ data: { gymId: f.gym.id, memberId: visited.id, result: "SUCCESS" } });
  const booked = await member(f, "booked");
  await prisma.classRegistration.create({ data: { gymId: f.gym.id, sessionId: f.session.id, memberId: booked.id, status: "PENDING_PAYMENT" } });
  await prisma.magicLink.create({ data: { memberId: clean.id, tokenHash: `t-${seq++}-${Date.now()}`, expiresAt: new Date(Date.now() + DAY) } });
  const url = (id: string) => `${baseURL}/api/${f.slug}/members/${id}`;

  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.delete(url(clean.id))).status()).toBe(403);
  await login(request, baseURL!, f.slug, f.owner);
  for (const m of [paid, visited, booked]) expect((await request.delete(url(m.id))).status(), m.fullName).toBe(409);
  expect(await prisma.member.count({ where: { gymId: f.gym.id } })).toBe(4);

  expect((await request.delete(url(clean.id))).ok()).toBeTruthy();
  expect(await prisma.member.count({ where: { id: clean.id } })).toBe(0);
  expect(await prisma.magicLink.count({ where: { memberId: clean.id } })).toBe(0);
  expect((await request.delete(url(clean.id))).status()).toBe(404);

  const theirs = await member(other, "theirs");
  expect((await request.delete(`${baseURL}/api/${f.slug}/members/${theirs.id}`)).status()).toBe(404);
  expect(await prisma.member.count({ where: { id: theirs.id } })).toBe(1);
});

test("a staff account can be deleted by the owner and loses access at once; the owner can't be", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const ownerRow = await prisma.staffUser.findFirstOrThrow({ where: { gymId: f.gym.id, role: "OWNER" } });
  const m = await member(f, "s");
  // Their work is kept, just without their name on it.
  const ci = await prisma.checkIn.create({ data: { gymId: f.gym.id, memberId: m.id, staffUserId: f.staffRow.id, result: "SUCCESS" } });

  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.delete(`${baseURL}/api/${f.slug}/staff/${f.staffRow.id}`)).status()).toBe(403);
  await login(request, baseURL!, f.slug, f.owner);
  expect((await request.delete(`${baseURL}/api/${f.slug}/staff/${ownerRow.id}`)).status()).toBe(409);
  expect((await request.delete(`${baseURL}/api/${f.slug}/staff/${f.staffRow.id}`)).ok()).toBeTruthy();
  expect(await prisma.staffUser.count({ where: { id: f.staffRow.id } })).toBe(0);
  expect((await prisma.checkIn.findUniqueOrThrow({ where: { id: ci.id } })).staffUserId).toBeNull();
  // Their old session stops working immediately, and they can't log in again.
  expect((await staffCtx.get(`${baseURL}/api/${f.slug}/finance/export?report=transactions`)).status()).toBe(401);
  const relogin = await staffCtx.post(`${baseURL}/api/${f.slug}/login`, { data: f.staff, headers: { "x-forwarded-for": "10.7.7.7" } });
  expect(relogin.ok()).toBeFalsy();

  const other = await makeGym();
  expect((await request.delete(`${baseURL}/api/${f.slug}/staff/${other.staffRow.id}`)).status()).toBe(404);
});

test("superadmin can delete a gym made by mistake, but only an empty one, with the slug typed back", async ({ request, baseURL }) => {
  const empty = await makeGym();
  const busy = await makeGym();
  await member(busy, "x");
  const guestOnly = await makeGym();
  await pass(guestOnly, { status: "PENDING_REVIEW" }); // an unpaid request doesn't count as history

  const url = (id: string) => `${baseURL}/api/superadmin/gyms/${id}`;
  expect((await request.delete(url(empty.gym.id), { data: { confirmSlug: empty.slug } })).status()).toBe(401); // not logged in
  const headers = { "x-forwarded-for": `10.6.${seq++ % 250}.1` };
  expect((await request.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" }, headers })).ok()).toBeTruthy();

  expect((await request.delete(url(empty.gym.id), { data: {} })).status()).toBe(400);
  expect((await request.delete(url(empty.gym.id), { data: { confirmSlug: "wrong" } })).status()).toBe(400);
  expect(await prisma.gym.count({ where: { id: empty.gym.id } })).toBe(1);
  expect((await request.delete(url(busy.gym.id), { data: { confirmSlug: busy.slug } })).status()).toBe(409);
  expect(await prisma.gym.count({ where: { id: busy.gym.id } })).toBe(1);

  expect((await request.delete(url(empty.gym.id), { data: { confirmSlug: empty.slug } })).ok()).toBeTruthy();
  expect(await prisma.gym.count({ where: { id: empty.gym.id } })).toBe(0);
  expect(await prisma.staffUser.count({ where: { gymId: empty.gym.id } })).toBe(0);
  expect(await prisma.gymClass.count({ where: { gymId: empty.gym.id } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { action: "GYM_DELETED" } })).toBeGreaterThan(0);
  expect((await request.delete(url(empty.gym.id), { data: { confirmSlug: empty.slug } })).status()).toBe(404);

  expect((await request.delete(url(guestOnly.gym.id), { data: { confirmSlug: guestOnly.slug } })).ok()).toBeTruthy();
  expect(await prisma.guestPass.count({ where: { gymId: guestOnly.gym.id } })).toBe(0);
});
