import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma, staffLoginUI } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { dayKeyInTimezone, zonedTimeToUtc } from "../src/lib/date";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function makeGym(memberCount = 2) {
  const tag = uniq("ops");
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({
    data: { name: `Ops Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE", timezone: "Asia/Jakarta" },
  });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const members = [];
  for (let i = 0; i < memberCount; i++) {
    const m = uniq("m");
    const phone = `0812${Date.now().toString().slice(-7)}${i}${seq}`;
    members.push({
      email: `${m}@test.local`,
      password: "member-pass-123",
      row: await prisma.member.create({
        data: {
          gymId: gym.id,
          planId: plan.id,
          fullName: `Member ${i + 1} ${m}`,
          email: `${m}@test.local`,
          phoneWhatsapp: encrypt(phone),
          phoneWhatsappLookup: hmacLookup(phone),
          passwordHash: await bcrypt.hash("member-pass-123", 10),
          status: "ACTIVE",
          membershipExpiry: new Date(Date.now() + 30 * DAY),
        },
      }),
    });
  }
  return { gym, owner, staff, plan, members, slug: tag };
}

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await request.post(`${baseURL}/api/${slug}/login`, { data: who });
  expect(res.ok(), `login ${who.email}`).toBeTruthy();
}

async function sessionWithBookings(f: Awaited<ReturnType<typeof makeGym>>, startsAt: Date, over: { price?: number } = {}) {
  const cls = await prisma.gymClass.create({ data: { gymId: f.gym.id, name: `Yoga ${seq++}`, instructor: "Ayu", price: over.price ?? 50000, durationMinutes: 60 } });
  const session = await prisma.classSession.create({ data: { gymId: f.gym.id, classId: cls.id, startsAt } });
  const regs = [];
  for (const m of f.members) {
    regs.push(await prisma.classRegistration.create({ data: { gymId: f.gym.id, sessionId: session.id, memberId: m.row.id, status: "CONFIRMED" } }));
  }
  return { cls, session, regs };
}

const cron = (request: APIRequestContext, baseURL: string) =>
  request.get(`${baseURL}/api/cron/class-reminders`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

test("staff mark attendance once a session is about to start; the member sees attended or missed", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(2);
  const soon = await sessionWithBookings(f, new Date(Date.now() + 10 * 60 * 1000));
  const later = await sessionWithBookings(f, new Date(Date.now() + 5 * HOUR));
  await login(request, baseURL!, f.slug, f.staff);
  const mark = (regId: string, attendance: string | null) =>
    request.post(`${baseURL}/api/${f.slug}/class-registrations/${regId}/attendance`, { data: { attendance } });

  // Too early for the later session; fine for the one starting in ten minutes.
  expect((await mark(later.regs[0].id, "ATTENDED")).status()).toBe(409);
  expect((await mark(soon.regs[0].id, "ATTENDED")).status()).toBe(200);
  expect((await mark(soon.regs[1].id, "NO_SHOW")).status()).toBe(200);
  let rows = await prisma.classRegistration.findMany({ where: { sessionId: soon.session.id }, orderBy: { createdAt: "asc" } });
  expect(rows.map((r) => r.attendance)).toEqual(["ATTENDED", "NO_SHOW"]);
  expect(rows[0].attendanceAt).not.toBeNull();

  // Clearing a mistaken mark, and garbage.
  expect((await mark(soon.regs[1].id, null)).status()).toBe(200);
  rows = await prisma.classRegistration.findMany({ where: { sessionId: soon.session.id }, orderBy: { createdAt: "asc" } });
  expect(rows[1].attendance).toBeNull();
  expect(rows[1].attendanceAt).toBeNull();
  expect((await mark(soon.regs[1].id, "LATE")).status()).toBe(400);

  // A cancelled booking has nothing to mark.
  await prisma.classRegistration.update({ where: { id: soon.regs[1].id }, data: { status: "CANCELLED" } });
  expect((await mark(soon.regs[1].id, "ATTENDED")).status()).toBe(409);

  // Another gym's staff can't reach it.
  const other = await makeGym(0);
  const otherCtx = await playwright.request.newContext();
  await login(otherCtx, baseURL!, other.slug, other.staff);
  expect((await otherCtx.post(`${baseURL}/api/${other.slug}/class-registrations/${soon.regs[0].id}/attendance`, { data: { attendance: "ATTENDED" } })).status()).toBe(404);
  await otherCtx.dispose();

  // The member's history says attended, not just booked.
  const memberCtx = await playwright.request.newContext();
  await memberCtx.post(`${baseURL}/api/${f.slug}/member-login`, { data: { email: f.members[0].email, password: f.members[0].password } });
  await prisma.classSession.update({ where: { id: soon.session.id }, data: { startsAt: new Date(Date.now() - 2 * HOUR) } });
  const page = await memberCtx.get(`${baseURL}/my/classes`);
  const html = await page.text();
  expect(html).toContain("Attended");
  await memberCtx.dispose();
});

test("the roster shows attendance buttons to staff and marking works in the browser", async ({ page, baseURL }) => {
  const f = await makeGym(1);
  const { cls, regs } = await sessionWithBookings(f, new Date(Date.now() + 5 * 60 * 1000));
  await page.addInitScript(() => window.localStorage.setItem("liftmora.classesView", "list"));
  await staffLoginUI(page, baseURL!, f.slug, f.staff.email, f.staff.password);
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/classes`);
  await page.getByRole("button", { name: /booked/ }).first().click();
  const group = page.getByRole("group", { name: `Attendance for ${f.members[0].row.fullName}` });
  await group.getByRole("button", { name: "Attended" }).click();
  await expect(group.getByRole("button", { name: "Attended" })).toHaveAttribute("aria-pressed", "true");
  expect((await prisma.classRegistration.findUniqueOrThrow({ where: { id: regs[0].id } })).attendance).toBe("ATTENDED");
  // Staff see no delete controls for the class.
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  expect(cls.id).toBeTruthy();
});

test("the reminder cron messages each confirmed booking for tomorrow once, and skips the rest", async ({ request, baseURL }) => {
  const f = await makeGym(2);
  // "Tomorrow" is the calendar day in the gym's timezone (Jakarta here), whatever the time it runs.
  const tomorrowKey = dayKeyInTimezone(new Date(Date.now() + DAY), "Asia/Jakarta");
  const dayAfterKey = dayKeyInTimezone(new Date(Date.now() + 2 * DAY), "Asia/Jakarta");
  const dueTomorrow = await sessionWithBookings(f, zonedTimeToUtc(`${tomorrowKey}T10:00`, "Asia/Jakarta"));
  const dayAfter = await sessionWithBookings(f, zonedTimeToUtc(`${dayAfterKey}T10:00`, "Asia/Jakarta"));
  const cancelled = await sessionWithBookings(f, zonedTimeToUtc(`${tomorrowKey}T18:00`, "Asia/Jakarta"));
  await prisma.classSession.update({ where: { id: cancelled.session.id }, data: { status: "CANCELLED" } });
  // One pending-payment booking on the soon session: not confirmed, so no reminder.
  const extra = await prisma.member.create({
    data: {
      gymId: f.gym.id,
      planId: f.plan.id,
      fullName: "Pending Pete",
      email: `${uniq("pp")}@test.local`,
      phoneWhatsapp: encrypt("081200008888"),
      phoneWhatsappLookup: hmacLookup("081200008888"),
      status: "ACTIVE",
      membershipExpiry: new Date(Date.now() + 30 * DAY),
    },
  });
  await prisma.classRegistration.create({ data: { gymId: f.gym.id, sessionId: dueTomorrow.session.id, memberId: extra.id, status: "PENDING_PAYMENT" } });

  expect((await request.get(`${baseURL}/api/cron/class-reminders`)).status()).toBe(401);

  const first = await cron(request, baseURL!);
  expect(first.ok()).toBeTruthy();
  const sentNow = (await first.json()).remindersSent;
  expect(sentNow).toBeGreaterThanOrEqual(2);

  const soonRegs = await prisma.classRegistration.findMany({ where: { sessionId: dueTomorrow.session.id } });
  expect(soonRegs.filter((r) => r.status === "CONFIRMED").every((r) => r.reminderSentAt !== null)).toBeTruthy();
  expect(soonRegs.find((r) => r.memberId === extra.id)!.reminderSentAt).toBeNull();
  expect((await prisma.classRegistration.findMany({ where: { sessionId: dayAfter.session.id } })).every((r) => r.reminderSentAt === null)).toBeTruthy();
  expect((await prisma.classRegistration.findMany({ where: { sessionId: cancelled.session.id } })).every((r) => r.reminderSentAt === null)).toBeTruthy();
  for (const m of f.members) {
    expect(await prisma.notificationLog.count({ where: { memberId: m.row.id, type: "class_reminder" } })).toBe(1);
  }

  // Running again sends nothing new for this gym.
  await cron(request, baseURL!);
  for (const m of f.members) {
    expect(await prisma.notificationLog.count({ where: { memberId: m.row.id, type: "class_reminder" } })).toBe(1);
  }
});

test("owner deletes unused plans, classes and sessions; anything with history can only be hidden", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(1);
  await login(request, baseURL!, f.slug, f.owner);

  // Plans: the one with a member stays; a fresh one goes.
  const spare = await prisma.membershipPlan.create({ data: { gymId: f.gym.id, name: "Spare", durationDays: 7, price: 50000 } });
  const used = await request.delete(`${baseURL}/api/${f.slug}/plans/${f.plan.id}`);
  expect(used.status()).toBe(409);
  expect((await used.json()).error).toContain("Hide it instead");
  expect((await request.delete(`${baseURL}/api/${f.slug}/plans/${spare.id}`)).status()).toBe(200);
  expect(await prisma.membershipPlan.findUnique({ where: { id: spare.id } })).toBeNull();
  expect((await request.delete(`${baseURL}/api/${f.slug}/plans/${spare.id}`)).status()).toBe(404);

  // Classes: booked ones stay; an unbooked one goes with its sessions.
  const booked = await sessionWithBookings(f, new Date(Date.now() + DAY));
  expect((await request.delete(`${baseURL}/api/${f.slug}/classes/${booked.cls.id}`)).status()).toBe(409);
  const empty = await prisma.gymClass.create({ data: { gymId: f.gym.id, name: "Empty", price: 0, durationMinutes: 30 } });
  const emptySession = await prisma.classSession.create({ data: { gymId: f.gym.id, classId: empty.id, startsAt: new Date(Date.now() + DAY) } });
  expect((await request.delete(`${baseURL}/api/${f.slug}/classes/${empty.id}`)).status()).toBe(200);
  expect(await prisma.gymClass.findUnique({ where: { id: empty.id } })).toBeNull();
  expect(await prisma.classSession.findUnique({ where: { id: emptySession.id } })).toBeNull();

  // Sessions: a booked one must be cancelled, an empty one can go.
  expect((await request.delete(`${baseURL}/api/${f.slug}/class-sessions/${booked.session.id}`)).status()).toBe(409);
  const spareSession = await prisma.classSession.create({ data: { gymId: f.gym.id, classId: booked.cls.id, startsAt: new Date(Date.now() + 2 * DAY) } });
  expect((await request.delete(`${baseURL}/api/${f.slug}/class-sessions/${spareSession.id}`)).status()).toBe(200);
  expect(await prisma.classSession.findUnique({ where: { id: spareSession.id } })).toBeNull();

  // Staff can't delete; another gym's owner can't see it.
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  const spare2 = await prisma.membershipPlan.create({ data: { gymId: f.gym.id, name: "Spare 2", durationDays: 7, price: 50000 } });
  expect((await staffCtx.delete(`${baseURL}/api/${f.slug}/plans/${spare2.id}`)).status()).toBe(403);
  expect((await staffCtx.delete(`${baseURL}/api/${f.slug}/classes/${booked.cls.id}`)).status()).toBe(403);
  await staffCtx.dispose();
  const other = await makeGym(0);
  const otherCtx = await playwright.request.newContext();
  await login(otherCtx, baseURL!, other.slug, other.owner);
  expect((await otherCtx.delete(`${baseURL}/api/${other.slug}/plans/${spare2.id}`)).status()).toBe(404);
  expect(await prisma.membershipPlan.findUnique({ where: { id: spare2.id } })).not.toBeNull();
  await otherCtx.dispose();
});

test("the Finance page counts class revenue alongside memberships", async ({ page, baseURL }) => {
  const f = await makeGym(1);
  const now = new Date();
  await prisma.payment.create({
    data: { gymId: f.gym.id, memberId: f.members[0].row.id, planId: f.plan.id, provider: "CASH", amount: 250000, status: "PAID", paidAt: now },
  });
  const { session } = await sessionWithBookings(f, now);
  const reg = await prisma.classRegistration.findFirstOrThrow({ where: { sessionId: session.id } });
  await prisma.classPayment.create({ data: { gymId: f.gym.id, registrationId: reg.id, provider: "XENDIT", amount: 50000, status: "PAID", paidAt: now } });
  await prisma.classPayment.create({
    data: {
      gymId: f.gym.id,
      registrationId: (await prisma.classRegistration.create({ data: { gymId: f.gym.id, sessionId: (await prisma.classSession.create({ data: { gymId: f.gym.id, classId: session.classId, startsAt: now } })).id, memberId: f.members[0].row.id, status: "PENDING_PAYMENT" } })).id,
      provider: "XENDIT",
      amount: 50000,
      status: "PENDING",
    },
  });

  await staffLoginUI(page, baseURL!, f.slug, f.owner.email, f.owner.password);
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/finance`);
  await expect(page.getByText("Rp 300.000").first()).toBeVisible();
  await expect(page.getByText("Rp 50.000 from classes")).toBeVisible();
  await expect(page.getByText("1 unpaid invoice")).toBeVisible();
  await expect(page.getByText(/Yoga \d+ class/).first()).toBeVisible();
});
